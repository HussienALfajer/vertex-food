// The location task is defined at the top of the entry file so that a background start (the OS delivering
// locations to a process with no screen) finds it before any component mounts.
import { registerRootComponent } from 'expo';
import './src/tracking';
import App from './App';

registerRootComponent(App);
