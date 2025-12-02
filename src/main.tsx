// main.tsx
import ReactDOM from 'react-dom/client';
import App from './App';

console.log('[main] bootstrapping app — main.tsx loaded'); // <--- add this line

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
    <App />
);
