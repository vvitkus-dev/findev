import { ThroughputMeter } from './throughput-meter';

describe('ThroughputMeter', () => {
  it('2 snapshots of 100 updates 500 ms apart ⇒ 200 updates/s', () => {
    // Arrange
    const meter = new ThroughputMeter();
    meter.record(0, 100);

    // Act
    const rate = meter.record(500, 200);

    // Assert
    expect(rate).toBe(200);
  });

  it('drops samples older than the 1 s window', () => {
    // Arrange
    const meter = new ThroughputMeter();
    meter.record(0, 1_000);
    meter.record(500, 1_100);

    // Act
    const rate = meter.record(1_000, 1_200);

    // Assert — the t=0 sample (1000 updates) left the window
    expect(rate).toBe(200);
  });

  it('uses cumulative totals, so a skipped snapshot loses no updates', () => {
    // Arrange
    const meter = new ThroughputMeter();
    meter.record(0, 100);

    // Act — the t=500 snapshot never arrived; the next one carries both batches
    const rate = meter.record(900, 300);

    // Assert
    expect(rate).toBe(300);
  });

  it('rate(now) decays to 0 when no snapshots arrive', () => {
    // Arrange
    const meter = new ThroughputMeter();
    meter.record(0, 500);

    // Act
    const rate = meter.rate(1_000);

    // Assert
    expect(rate).toBe(0);
  });

  it('clearWindow keeps the running total: after pause/resume only new updates count', () => {
    // Arrange
    const meter = new ThroughputMeter();
    meter.record(0, 5_000);
    meter.clearWindow();

    // Act
    const rate = meter.record(100, 5_100);

    // Assert
    expect(rate).toBe(100);
  });

  it('reset starts counting from zero again (a new run restarts its totals)', () => {
    // Arrange
    const meter = new ThroughputMeter();
    meter.record(0, 5_000);
    meter.reset();

    // Act
    const rate = meter.record(100, 100);

    // Assert
    expect(rate).toBe(100);
  });
});
