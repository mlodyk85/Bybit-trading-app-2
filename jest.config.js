module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    '^.+\\.jsx?$': 'babel-jest',
  },
  transformIgnorePatterns: [
    'node_modules/.pnpm/(?!(crypto-es)@)',
    'node_modules/(?!crypto-es|.pnpm)',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
};
