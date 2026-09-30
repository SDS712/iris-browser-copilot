/** Mounts the panel into a root: the side panel's document or the widget's Shadow DOM. */
import { render } from 'preact';
import type { IrisApp } from '../core/app';
import { Panel } from './components/Panel';
import { AppContext } from './context';
import { IRIS_CSS } from './styles';

export function mountPanel(root: ShadowRoot | HTMLElement, app: IrisApp): () => void {
  const style = document.createElement('style');
  style.textContent = IRIS_CSS;
  const container = document.createElement('div');
  container.className = 'iris-root';
  if (root instanceof ShadowRoot) root.append(style, container);
  else {
    // Inside a Shadow DOM the styles go into that root, never into the page's <head>.
    const rootNode = root.getRootNode();
    if (rootNode instanceof ShadowRoot) rootNode.append(style);
    else document.head.append(style);
    root.append(container);
  }
  render(
    <AppContext.Provider value={app}>
      <Panel />
    </AppContext.Provider>,
    container,
  );
  return () => {
    render(null, container);
    container.remove();
    style.remove();
  };
}
