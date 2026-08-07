import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './lib/AuthContext.jsx';
import { EntityProvider } from './lib/EntityContext.jsx';
import { ConfirmProvider } from './lib/ConfirmContext.jsx';
import { ToastProvider } from './components/Toast.jsx';
import './theme.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          {/* Inside AuthProvider, because which sets of books exist depends on
              who is signed in — and on whose books an accountant has open. */}
          <EntityProvider>
            {/* Innermost, so anything rendered can ask — and above App so the one
                dialog sits over whatever asked for it. */}
            <ConfirmProvider>
              <App />
            </ConfirmProvider>
          </EntityProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
