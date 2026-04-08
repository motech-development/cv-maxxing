import type { CvMaxxingWindowApi } from '../shared/window-api.js'

declare global {
  interface Window {
    cvMaxxing: CvMaxxingWindowApi
  }
}

export {}
