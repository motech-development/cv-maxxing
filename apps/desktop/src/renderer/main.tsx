import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@fontsource/manrope/400.css'
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/700.css'
import '@fontsource/manrope/800.css'

import { App } from './app.js'
import './styles.css'

const rootElement = document.querySelector('#root')

if (rootElement === null) {
  throw new Error('Root element "#root" was not found.')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
