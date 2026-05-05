/**
 * Manual Jest mock for next/cache
 */
const revalidatePath = jest.fn();
const revalidateTag = jest.fn();

module.exports = { revalidatePath, revalidateTag };
