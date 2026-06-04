module.exports = {
  preset: 'react-native',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleNameMapper: {
    '^@app/(.*)$': '<rootDir>/src/app/$1',
    '^@components/(.*)$': '<rootDir>/src/components/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@liveness/(.*)$': '<rootDir>/src/liveness/$1',
    '^@screens/(.*)$': '<rootDir>/src/screens/$1',
    '^@storage/(.*)$': '<rootDir>/src/storage/$1',
    '^@sync/(.*)$': '<rootDir>/src/sync/$1',
    '^@types/(.*)$': '<rootDir>/src/types/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
  },
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/deploy/'],
  modulePathIgnorePatterns: ['<rootDir>/deploy/'],
  watchPathIgnorePatterns: ['<rootDir>/deploy/', '<rootDir>/node_modules/'],
};
