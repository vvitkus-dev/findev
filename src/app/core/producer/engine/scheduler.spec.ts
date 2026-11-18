import { realClock, realScheduler } from './scheduler';
import { ManualScheduler } from './testing/manual-scheduler';

describe('ManualScheduler', () => {
  it('runs due tasks in time order, with now() at each task due time', () => {
    // Arrange
    const s = new ManualScheduler();
    const log: string[] = [];
    s.schedule(300, () => log.push(`c@${String(s.now())}`));
    s.schedule(100, () => log.push(`a@${String(s.now())}`));
    s.schedule(200, () => log.push(`b@${String(s.now())}`));

    // Act
    s.advance(1_000);

    // Assert
    expect(log).toEqual(['a@100', 'b@200', 'c@300']);
    expect(s.now()).toBe(1_000);
  });

  it('runs equal due times in scheduling order', () => {
    // Arrange
    const s = new ManualScheduler();
    const log: number[] = [];
    for (const n of [1, 2, 3]) s.schedule(50, () => log.push(n));

    // Act
    s.advance(50);

    // Assert
    expect(log).toEqual([1, 2, 3]);
  });

  it('does not run tasks that are not yet due', () => {
    // Arrange
    const s = new ManualScheduler();
    const task = vi.fn();
    s.schedule(500, task);

    // Act
    s.advance(499);

    // Assert
    expect(task).not.toHaveBeenCalled();
    expect(s.pending).toBe(1);
  });

  it('cancel prevents a task from running', () => {
    // Arrange
    const s = new ManualScheduler();
    const task = vi.fn();
    const handle = s.schedule(10, task);
    s.cancel(handle);

    // Act
    s.advance(100);

    // Assert
    expect(task).not.toHaveBeenCalled();
    expect(s.pending).toBe(0);
  });

  it('runs tasks scheduled during advance when they fall due inside it (self-rescheduling)', () => {
    // Arrange
    const s = new ManualScheduler();
    const ticks: number[] = [];
    const tick = (): void => {
      ticks.push(s.now());
      s.schedule(500, tick);
    };
    s.schedule(0, tick);

    // Act
    s.advance(1_500);

    // Assert
    expect(ticks).toEqual([0, 500, 1_000, 1_500]);
  });

  it('elapse moves the clock without running tasks', () => {
    // Arrange
    const s = new ManualScheduler();
    const task = vi.fn();
    s.schedule(100, task);

    // Act
    s.elapse(700);

    // Assert
    expect(s.now()).toBe(700);
    expect(task).not.toHaveBeenCalled();
  });

  it('treats a negative delay as 0', () => {
    // Arrange
    const s = new ManualScheduler();
    const task = vi.fn();
    s.schedule(-50, task);

    // Act
    s.advance(0);

    // Assert
    expect(task).toHaveBeenCalledOnce();
  });

  it('stops a runaway 0 ms loop instead of hanging', () => {
    // Arrange
    const s = new ManualScheduler();
    const loop = (): void => {
      s.schedule(0, loop);
    };
    s.schedule(0, loop);

    // Act
    const run = (): void => {
      s.advance(1);
    };

    // Assert
    expect(run).toThrow(/runaway/);
  });
});

describe('realScheduler / realClock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules with setTimeout and cancels with clearTimeout', () => {
    // Arrange
    const kept = vi.fn();
    const cancelled = vi.fn();
    realScheduler.schedule(100, kept);
    realScheduler.cancel(realScheduler.schedule(100, cancelled));

    // Act
    vi.advanceTimersByTime(100);

    // Assert
    expect(kept).toHaveBeenCalledOnce();
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('realClock follows performance.now()', () => {
    // Arrange
    const before = realClock.now();

    // Act
    vi.advanceTimersByTime(250);

    // Assert
    expect(realClock.now() - before).toBe(250);
  });
});
