import React from 'react';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { DostLauncherWidget } from './DostLauncherWidget';

const nameToWidget = {
  DostLauncher: DostLauncherWidget,
};

/**
 * Android calls this when the widget is added, updated, resized, or tapped.
 * We only need to draw the calm static card — tap opens the app (Step 5).
 */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const widgetInfo = props.widgetInfo;
  const Widget =
    nameToWidget[widgetInfo.widgetName as keyof typeof nameToWidget];

  if (!Widget) {
    return;
  }

  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
      props.renderWidget(<Widget />);
      break;

    case 'WIDGET_CLICK':
      // Tap opens the app. Landing on chat (when signed in) is handled
      // by existing auth routing; optional deep link can come later.
      break;

    default:
      break;
  }
}
