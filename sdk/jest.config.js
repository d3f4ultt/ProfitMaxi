/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  globals: {
    'ts-jest': {
      tsconfig: {
        // Relax some strict settings that trip up test files
        noUnusedLocals: false,
        noUnusedParameters: false,
      },
    },
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
};
