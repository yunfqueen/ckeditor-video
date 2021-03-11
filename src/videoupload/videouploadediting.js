import Plugin from '@ckeditor/ckeditor5-core/src/plugin';
import Notification from '@ckeditor/ckeditor5-ui/src/notification/notification';
import UploadVideoCommand from "./uploadvideocommand";
import FileRepository from "@ckeditor/ckeditor5-upload/src/filerepository";
import {
    createVideoMediaTypeRegExp,
    fetchLocalVideo,
    getVideosFromChangeItem,
    isHtmlIncluded,
    isLocalVideo
} from "./utils";
import Clipboard from "@ckeditor/ckeditor5-clipboard/src/clipboard";
import UpcastWriter from "@ckeditor/ckeditor5-engine/src/view/upcastwriter";
import env from "@ckeditor/ckeditor5-utils/src/env";
import { getViewVideoFromWidget } from "../video/utils";

const DEFAULT_VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg'];


export default class VideoUploadEditing extends Plugin {
    static get requires() {
        return [FileRepository, Notification, Clipboard];
    }

    constructor(editor) {
        super(editor);

        editor.config.define('video.upload', {
            types: DEFAULT_VIDEO_EXTENSIONS,
            allowMultipleFiles: true,
        });
    }

    init() {
        const editor = this.editor;
        const doc = editor.model.document;
        const schema = editor.model.schema;
        const conversion = editor.conversion;
        const fileRepository = editor.plugins.get(FileRepository);
        const videoTypes = createVideoMediaTypeRegExp(editor.config.get('video.upload.types'));

        schema.extend('video', {
            allowAttributes: ['uploadId', 'uploadStatus']
        });

        editor.commands.add('uploadVideo', new UploadVideoCommand(editor))

        // 注册上投转换器uploadId。
        conversion.for('upcast')
            .attributeToAttribute({
                view: {
                    name: 'video',
                    key: 'uploadId'
                },
                model: 'uploadId'
            });

        //处理粘贴视频。
        //对于每个视频文件，将创建一个新的文件加载器和一个占位符图像
        //插入到内容。然后，这些视频一旦出现在模型中就会被上传
        //(参见下面的文档#change listener)。

        this.listenTo(editor.editing.view.document, 'clipboardInput', (evt, data) => {
            // 如果包含非空HTML数据，则跳过。
            // https://github.com/ckeditor/ckeditor5-upload/issues/68
            if (isHtmlIncluded(data.dataTransfer)) {
                return;
            }

            const videos = Array.from(data.dataTransfer.files).filter(file => {
                // See https://github.com/ckeditor/ckeditor5-image/pull/254.
                if (!file) {
                    return false;
                }

                return videoTypes.test(file.type);
            });

            const ranges = data.targetRanges.map(viewRange => editor.editing.mapper.toModelRange(viewRange));

            editor.model.change(writer => {
                // 设置“选择”为“粘贴目标”。
                writer.setSelection(ranges);

                if (videos.length) {
                    evt.stop();

                    // 在选择改变后上传视频，以确保命令的状态被刷新。
                    editor.model.enqueueChange('default', () => {
                        editor.execute('videoUpload', { file: videos });
                    });
                }
            });
        });

        //处理带有base64或blob源图像的HTML粘贴。
        //对于每个图像文件，将创建一个新的文件加载器和一个占位符图像
        //插入到内容。然后，这些图像一旦出现在模型中就会被上传
        //(参见下面的文档#change listener)。
        this.listenTo(editor.plugins.get(Clipboard), 'inputTransformation', (evt, data) => {
            const fetchableVideos = Array.from(editor.editing.view.createRangeIn(data.content))
                .filter(value => isLocalVideo(value.item) && !value.item.getAttribute('uploadProcessed'))
                .map(value => {
                    return { promise: fetchLocalVideo(value.item), videoElement: value.item };
                });

            if (!fetchableVideos.length) {
                return;
            }

            const writer = new UpcastWriter(editor.editing.view.document);

            for (const fetchableVideo of fetchableVideos) {
                // 设置标记该视频已被处理的属性。
                writer.setAttribute('uploadProcessed', true, fetchableVideo.videoElement);

                const loader = fileRepository.createLoader(fetchableVideo.promise);

                if (loader) {
                    writer.setAttribute('src', '', fetchableVideo.videoElement);
                    writer.setAttribute('controls', 'controls', fetchableVideo.videoElement);
                    writer.setAttribute('uploadId', loader.id, fetchableVideo.videoElement);
                }
            }
        });

        // 防止浏览器重定向到已删除的视频。
        editor.editing.view.document.on('dragover', (evt, data) => {
            data.preventDefault();
        });


        // 上传模型中出现的占位符视频。
        doc.on('change', () => {
            const changes = doc.differ.getChanges({ includeChangesInGraveyard: true });
            for (const entry of changes) {
                if (entry.type === 'insert' && entry.name !== '$text') {
                    const item = entry.position.nodeAfter;
                    const isInGraveyard = entry.position.root.rootName === '$graveyard';

                    for (const video of getVideosFromChangeItem(editor, item)) {
                        // 检查视频元素是否仍然有上传id。
                        const uploadId = video.getAttribute('uploadId');

                        if (!uploadId) {
                            continue;
                        }

                        // 检查视频是否加载到这个客户端。
                        const loader = fileRepository.loaders.get(uploadId);

                        if (!loader) {
                            continue;
                        }

                        if (isInGraveyard) {
                            //如果视频被插入到墓地-中止加载过程。
                            // If the video was inserted to the graveyard - abort the loading process.
                            loader.abort();
                        } else if (loader.status === 'idle') {
                            // 如果视频被插入到内容中，并且还没有加载，开始加载它。
                            this._readAndUpload(loader, video);
                        }
                    }
                }
            }
        });
    }

    //读取和上传图片。
    //镜像从磁盘读取，作为一个base64编码的字符串，它被临时设置为`image[src]`的形象。上传成功后，
    //将临时数据替换为目标数据图片的URL(上传的图片在服务器上的URL)。
    _readAndUpload(loader, videoElement) {
        const editor = this.editor;
        const model = editor.model;
        const t = editor.locale.t;
        const fileRepository = editor.plugins.get(FileRepository);
        const notification = editor.plugins.get(Notification);
        model.enqueueChange('transparent', writer => {
            writer.setAttribute('uploadStatus', 'reading', videoElement);
            writer.setAttribute('width', '100%', videoElement);
        });

        return loader.read()
            .then(() => {
                const promise = loader.upload();
                // 在Safari中强制重绘。没有它，视频将显示错误的大小。
                // https://github.com/ckeditor/ckeditor5/issues/1975
                /* istanbul ignore next */
                if (env.isSafari) {
                    const viewFigure = editor.editing.mapper.toViewElement(videoElement);
                    const viewVideo = getViewVideoFromWidget(viewFigure);

                    editor.editing.view.once('render', () => {
                        // Early returns just to be safe. There might be some code ran
                        // in between the outer scope and this callback.
                        //安全起见，提前回来。可能有一些代码在外部作用域和这个回调函数之间。
                        if (!viewVideo.parent) {
                            return;
                        }

                        const domFigure = editor.editing.view.domConverter.mapViewToDom(viewVideo.parent);

                        if (!domFigure) {
                            return;
                        }

                        const originalDisplay = domFigure.style.display;

                        domFigure.style.display = 'none';

                        // 确保这一行在缩小过程中不会因为“没有效果”而被删除。
                        domFigure._ckHack = domFigure.offsetHeight;

                        domFigure.style.display = originalDisplay;
                    });
                }

                model.enqueueChange('transparent', writer => {
                    writer.setAttribute('uploadStatus', 'uploading', videoElement);
                    writer.setAttribute('width', '100%', videoElement);
                });

                return promise;
            })
            .then(data => {
                model.enqueueChange('transparent', writer => {
                    writer.setAttributes({ uploadStatus: 'complete', width: '100%', src: data.default }, videoElement);
                });
                clean();
            })
            .catch(error => {
                //如果status不是'error'，也不是'aborted'，抛出错误，因为它意味着有其他的错误，
                //这可能是一个通用错误，要找出发生了什么是非常痛苦的。
                if (loader.status !== 'error' && loader.status !== 'aborted') {
                    throw error;
                }

                // Might be 'aborted'.
                if (loader.status === 'error' && error) {
                    notification.showWarning(error, {
                        title: t('Upload failed'),
                        namespace: 'upload'
                    });
                }

                clean();
                //从插入批处理中永久删除视频。
                model.enqueueChange('transparent', writer => {
                    writer.remove(videoElement);
                });
            });

        function clean() {
            model.enqueueChange('transparent', writer => {
                writer.removeAttribute('uploadId', videoElement);
                writer.removeAttribute('uploadStatus', videoElement);
                writer.removeAttribute('width', videoElement);
                // writer.removeAttribute('height', videoElement);
            });
            fileRepository.destroyLoader(loader);
        }
    }
}
