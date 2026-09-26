/**
 * Entry point for learnOwnership.
 */

import './styles/main.css';
import { mountApp } from './ui/app';

const root = document.getElementById('app');
if (!root) {
  throw new Error('#app root missing');
}
mountApp(root);
