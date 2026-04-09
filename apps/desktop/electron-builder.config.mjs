export default {
  appId: 'com.motechdevelopment.cv-maxxing',
  asar: true,
  directories: {
    output: 'release',
  },
  extraMetadata: {
    main: 'dist/main/main.js',
  },
  files: ['dist/**/*', '!dist/**/__tests__/**', 'package.json'],
  mac: {
    category: 'public.app-category.productivity',
    hardenedRuntime: false,
    identity: null,
    target: [
      {
        arch: ['x64'],
        target: 'dir',
      },
    ],
  },
  nodeGypRebuild: false,
  npmRebuild: false,
}
