/**
 * Lazy module initialization utility.
 * Creates a getter function that initializes a module on first access and caches it.
 */

/**
 * Create a lazy module getter. The factory is called once on first access,
 * and the result is cached for subsequent calls.
 *
 * @param {Function} factory - Factory function that creates and returns the module instance
 * @returns {Function} Getter function that returns the cached module instance
 */
export function createLazyModule(factory) {
  let instance = null;
  let initialized = false;
  return () => {
    if (!initialized) {
      instance = factory();
      initialized = true;
    }
    return instance;
  };
}
