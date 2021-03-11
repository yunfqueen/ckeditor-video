import Plugin from '@ckeditor/ckeditor5-core/src/plugin';
import FileRepository from '@ckeditor/ckeditor5-upload/src/filerepository';
import uploadingPlaceholder from '../../theme/icons/video_placeholder.svg';
import { getViewVideoFromWidget } from '../video/utils';

import '../../theme/videouploadprogress.css';
import '../../theme/videouploadicon.css';
import '../../theme/videouploadloader.css';

//图像上传进度插件。
//它显示一个占位符，当图像从磁盘读取和一个进度条，而图像正在上传
export default class VideoUploadProgress extends Plugin {
    constructor(editor) {
        super(editor);
        //在访问真实图像数据之前显示的图像占位符。
        this.placeholder = 'data:video/svg+xml;utf8,' + encodeURIComponent(uploadingPlaceholder);
    }

    init() {
        const editor = this.editor;

        // Upload status change - update video's view according to that status.
        // 上传状态改变-根据该状态更新视频的看法。
        editor.editing.downcastDispatcher.on('attribute:uploadStatus:video', (...args) => this.uploadStatusChange(...args));
    }

    //每次图像的' uploadStatus '属性发生改变时，都会调用这个方法。
    uploadStatusChange(evt, data, conversionApi) {
        const editor = this.editor;
        const modelVideo = data.item;
        const uploadId = modelVideo.getAttribute('uploadId');

        if (!conversionApi.consumable.consume(data.item, evt.name)) {
            return;
        }

        const fileRepository = editor.plugins.get(FileRepository);
        const status = uploadId ? data.attributeNewValue : null;
        const placeholder = this.placeholder;
        const viewFigure = editor.editing.mapper.toViewElement(modelVideo);
        const viewWriter = conversionApi.writer;

        if (status === 'reading') {
            // Start "appearing" effect and show placeholder with infinite progress bar on the top
            // while video is read from disk.
            //look
            //开始“出现”效果，并在顶部显示无限进度条占位符
            //当从磁盘读取视频时。  
            _startAppearEffect(viewFigure, viewWriter);
            _showPlaceholder(placeholder, viewFigure, viewWriter);

            return;
        }

        // Show progress bar on the top of the video when video is uploading.
        //上传视频时，在视频顶部显示进度条。
        if (status === 'uploading') {
            const loader = fileRepository.loaders.get(uploadId);

            // Start appear effect if needed - see https://github.com/ckeditor/ckeditor5-image/issues/191.
            _startAppearEffect(viewFigure, viewWriter);

            if (!loader) {
                // There is no loader associated with uploadId - this means that video came from external changes.
                // In such cases we still want to show the placeholder until video is fully uploaded.
                //没有加载器与uploadId相关联，这意味着视频来自外部变化。
                //在这种情况下，我们仍然希望显示占位符，直到视频完全上传。
                // Show placeholder if needed - see https://github.com/ckeditor/ckeditor5-image/issues/191.
                _showPlaceholder(placeholder, viewFigure, viewWriter);
            } else {
                // Hide placeholder and initialize progress bar showing upload progress.
                // 隐藏占位符并初始化显示上传进度的进度条。
                //上传过程中会出现二次闪现占位符，所以将其去掉
                // _hidePlaceholder(viewFigure, viewWriter);
                // _showProgressBar(viewFigure, viewWriter, loader, editor.editing.view);
                // _displayLocalVideo(viewFigure, viewWriter, loader);
            }

            return;
        }

        if (status === 'complete' && fileRepository.loaders.get(uploadId)) {
            _showCompleteIcon(viewFigure, viewWriter, editor.editing.view);
        }

        // Clean up.
        // _hideProgressBar(viewFigure, viewWriter);
        _hidePlaceholder(viewFigure, viewWriter);
        _stopAppearEffect(viewFigure, viewWriter);
    }
}

// 如果尚未应用ck-appear类，则将其添加到图像图形中。
function _startAppearEffect(viewFigure, writer) {
    if (!viewFigure.hasClass('ck-appear')) {
        writer.addClass('ck-appear', viewFigure);
    }
}

// 如果一个类还没有被删除，则将ck-appear类移除到图像图形。
function _stopAppearEffect(viewFigure, writer) {
    writer.removeClass('ck-appear', viewFigure);
}

// 在给定图像数字上显示占位符和无限进度条。
function _showPlaceholder(placeholder, viewFigure, writer) {
    if (!viewFigure.hasClass('ck-video-upload-placeholder')) {
        writer.addClass('ck-video-upload-placeholder', viewFigure);
    }

    const viewVideo = getViewVideoFromWidget(viewFigure);

    if (viewVideo.getAttribute('src') !== placeholder) {
        writer.setAttribute('src', placeholder, viewVideo);
    }

    writer.setAttribute('controls', 'controls', viewVideo);
    writer.setAttribute('width', '100%', viewVideo);

    // if (!_getUIElement(viewFigure, 'placeholder')) {
    //     writer.insert(writer.createPositionAfter(viewVideo), _createPlaceholder(writer));
    // }
}

// 移除占位符和无限进度条在给定的图像数字。
function _hidePlaceholder(viewFigure, writer) {
    if (viewFigure.hasClass('ck-video-upload-placeholder')) {
        writer.removeClass('ck-video-upload-placeholder', viewFigure);
    }

    _removeUIElement(viewFigure, writer, 'placeholder');
}

//显示上传进度条。
//将它附加到文件加载器中，以便当上传百分比变化时进行更新。
function _showProgressBar(viewFigure, writer, loader, view) {
    const progressBar = _createProgressBar(writer);
    writer.insert(writer.createPositionAt(viewFigure, 'end'), progressBar);

    // Update progress bar width when uploadedPercent is changed.
    // 当uploadedPercent改变时，更新进度条宽度。
    loader.on('change:uploadedPercent', (evt, name, value) => {
        view.change(writer => {
            writer.setStyle('width', value + '%', progressBar);
        });
    });
}

//Hides upload progress bar.
function _hideProgressBar(viewFigure, writer) {
    _removeUIElement(viewFigure, writer, 'progressBar');
}

//显示完整的图标，并在一定的时间后隐藏。
function _showCompleteIcon(viewFigure, writer, view) {
    const completeIcon = writer.createUIElement('div', { class: 'ck-video-upload-complete-icon' });

    writer.insert(writer.createPositionAt(viewFigure, 'end'), completeIcon);

    setTimeout(() => {
        view.change(writer => writer.remove(writer.createRangeOn(completeIcon)));
    }, 3000);
}

//使用{@link module:engine/view/uielement~ uielement}创建进度条元素。
function _createProgressBar(writer) {
    const progressBar = writer.createUIElement('div', { class: 'ck-progress-bar' });

    writer.setCustomProperty('progressBar', true, progressBar);

    return progressBar;
}

function _createPlaceholder(writer) {
    const placeholder = writer.createUIElement('div', { class: 'ck-upload-placeholder-loader' });

    writer.setCustomProperty('placeholder', true, placeholder);

    return placeholder;
}

function _getUIElement(videoFigure, uniqueProperty) {
    for (const child of videoFigure.getChildren()) {
        if (child.getCustomProperty(uniqueProperty)) {
            return child;
        }
    }
}

function _removeUIElement(viewFigure, writer, uniqueProperty) {
    const element = _getUIElement(viewFigure, uniqueProperty);

    if (element) {
        writer.remove(writer.createRangeOn(element));
    }
}

//从文件加载器显示本地数据。
function _displayLocalVideo(viewFigure, writer, loader) {
    if (loader.data) {
        const viewVideo = getViewVideoFromWidget(viewFigure);

        writer.setAttribute('src', loader.data, viewVideo);
        writer.setAttribute('controls', 'controls', viewVideo);
        writer.setAttribute('width', '100%', viewVideo);
    }
}
