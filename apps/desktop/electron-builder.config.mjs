export default {
  appId: 'com.motechdevelopment.cv-maxxing',
  asar: true,
  directories: {
    output: 'release',
  },
  extraMetadata: {
    main: 'dist/main/main.js',
  },
  files: ['dist/**/*', '!dist/**/__tests__/**', 'package.json', 'assets/**/*'],
  productName: 'CV Maxxing',
  mac: {
    category: 'public.app-category.productivity',
    hardenedRuntime: false,
    icon: 'assets/app-icon.png',
    identity: null,
    target: [
      {
        arch: ['x64', 'arm64'],
        target: 'dir',
      },
    ],
  },
  nodeGypRebuild: false,
  npmRebuild: false,
};
