import { TestBed } from '@angular/core/testing';
import { BUILD_VERSION } from './build-info';

describe('BUILD_VERSION', () => {
  it('defaults to the build-time define ("dev" outside CI)', () => {
    // Arrange
    TestBed.configureTestingModule({});

    // Act
    const version = TestBed.inject(BUILD_VERSION);

    // Assert
    expect(version).toBe('dev');
  });
});
