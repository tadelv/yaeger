export class PIDController {
  private kp: number; // Proportional constant
  private ki: number; // Integral constant
  private kd: number; // Derivative constant

  private previousError: number;
  private integral: number;

  constructor(kp: number, ki: number, kd: number) {
    this.kp = kp;
    this.ki = ki;
    this.kd = kd;

    this.previousError = 0;
    this.integral = 0;
  }

  // Method to compute PID output based on error
  public compute(setpoint: number, currentValue: number): number {
    // Calculate the error
    const error = setpoint - currentValue;

    // Proportional term
    const pTerm = this.kp * error;

    // Integral term (accumulated error)
    this.integral += error;
    const iTerm = this.ki * this.integral;

    // Derivative term (rate of change of error)
    const dTerm = this.kd * (error - this.previousError);

    // Save the current error for the next calculation
    this.previousError = error;

    // Sum of all terms
    const output = pTerm + iTerm + dTerm;

    return output;
  }

  // Optionally, reset the controller state
  public reset() {
    this.previousError = 0;
    this.integral = 0;
  }
}
