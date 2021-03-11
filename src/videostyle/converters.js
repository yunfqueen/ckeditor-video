import first from '@ckeditor/ckeditor5-utils/src/first';

export function modelToViewStyleAttribute( styles ) {
    return ( evt, data, conversionApi ) => {
        if ( !conversionApi.consumable.consume( data.item, evt.name ) ) {
            return;
        }

        // Check if there is class name associated with given value. 检查是否有与给定值相关联的类名。
        const newStyle = getStyleByName( data.attributeNewValue, styles );
        const oldStyle = getStyleByName( data.attributeOldValue, styles );

        const viewElement = conversionApi.mapper.toViewElement( data.item );
        const viewWriter = conversionApi.writer;

        if ( oldStyle ) {
            viewWriter.removeClass( oldStyle.className, viewElement );
        }

        if ( newStyle ) {
            viewWriter.addClass( newStyle.className, viewElement );
        }
    };
}

export function viewToModelStyleAttribute( styles ) {
    // Convert only non–default styles.
    const filteredStyles = styles.filter( style => !style.isDefault );

    return ( evt, data, conversionApi ) => {
        if ( !data.modelRange ) {
            return;
        }

        const viewFigureElement = data.viewItem;
        const modelVideoElement = first( data.modelRange.getItems() );

        // Check if `videoStyle` attribute is allowed for current element.
        // 检查当前元素是否允许' videoStyle '属性。
        if ( !conversionApi.schema.checkAttribute( modelVideoElement, 'videoStyle' ) ) {
            return;
        }

        // Convert style one by one. 逐个转换样式。
        for ( const style of filteredStyles ) {
            // Try to consume class corresponding with style. 尝试使用与样式对应的类。
            if ( conversionApi.consumable.consume( viewFigureElement, { classes: style.className } ) ) {
                // And convert this style to model attribute. 并将此样式转换为model属性。
                conversionApi.writer.setAttribute( 'videoStyle', style.name, modelVideoElement );
            }
        }
    };
}

function getStyleByName( name, styles ) {
    for ( const style of styles ) {
        if ( style.name === name ) {
            return style;
        }
    }
}
