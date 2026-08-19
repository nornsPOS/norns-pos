/**
 * Thrown for any Money-related precondition violation:
 * - Invalid input strings
 * - Currency mismatch in arithmetic / comparison
 * - Division by zero
 */
export class MoneyError extends Error {
  override readonly name = 'MoneyError';

  constructor(message: string) {
    super(message);
  }
}
