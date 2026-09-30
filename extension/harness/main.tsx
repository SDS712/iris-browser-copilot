import { createIrisApp } from '../src/core/app';
import { mountPanel } from '../src/ui/mount';
import { harnessOptions } from './flags';

const root = document.getElementById('iris-harness-panel');
if (root) mountPanel(root, createIrisApp(harnessOptions()));
