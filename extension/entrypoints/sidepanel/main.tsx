import { startPanel } from '../../src/extension/panel-main';

const root = document.getElementById('app');
if (root) {
  void startPanel(root, {
    apiBase: __IRIS_API_BASE__,
    mockVoice: __IRIS_MOCK_VOICE__,
    debug: __IRIS_DEBUG__,
  });
}
