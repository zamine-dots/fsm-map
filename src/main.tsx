import React from 'react';
import ReactDOM from 'react-dom/client';
import NavigatorApp from './NavigatorApp';
import './navigator.css';
import './planning.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <NavigatorApp />
  </React.StrictMode>,
);
