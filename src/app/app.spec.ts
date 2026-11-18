import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('should create the app', () => {
    // Act
    const fixture = TestBed.createComponent(App);

    // Assert
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render title', async () => {
    // Arrange
    const fixture = TestBed.createComponent(App);

    // Act
    await fixture.whenStable();

    // Assert
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Hello, findev');
  });
});
