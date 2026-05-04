/**
 * Manual Jest mock for resend
 * Ensures jest.mock("resend", () => {...}) factory mocks are intercepted
 * correctly in test file import scope.
 */
const Resend = jest.fn();

module.exports = { Resend };
