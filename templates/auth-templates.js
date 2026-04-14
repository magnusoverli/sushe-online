const headerComponent = (_user, activeSection = 'home') => `
  <header class="z-50 border-b border-gray-700/50" style="background: linear-gradient(to top, rgba(43,49,71,0.5) 0%, rgba(9,13,23,0.5) 100%), linear-gradient(90deg, #2b3147 20%, #090d17 100%)">
    <!-- Safe area fill: extends header gradient behind iOS status bar/notch -->
    <div class="fixed top-0 left-0 right-0 z-50" style="height: env(safe-area-inset-top, 0px); background: linear-gradient(90deg, #2b3147 20%, #090d17 100%)"></div>
    <div class="relative flex items-center justify-between h-12 lg:h-14 px-3 lg:px-0">
      <!-- Mobile menu button -->
      <div class="flex items-center gap-2 lg:w-[14.5rem] lg:justify-center lg:gap-0">
        ${
          activeSection === 'home'
            ? `
        <button onclick="toggleMobileMenu()" class="lg:hidden p-2 -m-2 text-gray-400 active:text-white touch-target">
          <i class="fas fa-bars text-lg"></i>
        </button>
        `
            : `
        <a href="/" class="lg:hidden p-2 -m-2 text-gray-400 active:text-white touch-target">
          <i class="fas fa-arrow-left text-lg"></i>
        </a>
        `
        }
        <a href="/" class="hidden lg:inline text-xl lg:text-2xl font-bold text-red-600 hover:text-red-500 transition duration-200">SuShe</a>
      </div>

      <!-- Current list name (mobile only) -->
      <span id="mobileCurrentListName" class="lg:hidden absolute left-1/2 -translate-x-1/2 text-base text-gray-300 font-medium truncate max-w-[60%] hidden"></span>

      <!-- Year lock indicator (desktop only, populated by JS) -->
      <div id="headerLockIndicator" class="hidden lg:flex items-center gap-2 text-yellow-400 text-sm flex-1 justify-center"></div>

      <!-- User menu -->
      <div class="flex items-center pr-0.5 lg:pr-3">
        <button onclick="window.openAboutModal && window.openAboutModal()" class="p-2 -m-2 flex items-center justify-center text-gray-400 hover:text-white transition duration-200 touch-target" title="About" id="aboutButton">
          <i class="fas fa-info-circle text-lg"></i>
        </button>
        <button onclick="window.openSettingsDrawer && window.openSettingsDrawer()" class="p-2 -m-2 flex items-center justify-center text-gray-400 hover:text-white transition duration-200 touch-target ml-3 lg:ml-4" title="Settings" id="newSettingsButton">
          <i class="fas fa-sliders-h text-lg"></i>
        </button>
        <a href="/logout" class="p-2 -m-2 flex items-center justify-center text-gray-400 hover:text-white transition duration-200 touch-target ml-3 lg:ml-4" title="Logout">
          <i class="fas fa-sign-out-alt text-lg"></i>
        </a>
      </div>
    </div>
  </header>
`;

function createAuthTemplates(deps = {}) {
  const { escapeHtml, htmlTemplate, loginSnippetFn } = deps;

  const registerTemplate = (req, flash) =>
    htmlTemplate(
      `
  <div class="bg-gray-900/90 backdrop-blur-xs border border-gray-800 rounded-lg p-8 shadow-2xl">
    <div class="text-center mb-8">
      <h1 class="metal-title text-4xl font-bold text-red-600 glow-red mb-2">Join SuShe Online</h1>
    </div>

    <form method="post" action="/register" class="space-y-6">
      <input type="hidden" name="_csrf" value="${req.csrfToken()}" />
      <div>
        <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="email">
          Email Address
        </label>
        <input
          class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-sm text-white placeholder-gray-500 focus:outline-hidden transition duration-200"
          name="email"
          id="email"
          type="email"
          placeholder="your@email.com"
          required
          autocomplete="email"
        />
      </div>

      <div>
        <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="username">
          Username
        </label>
        <input
          class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-sm text-white placeholder-gray-500 focus:outline-hidden transition duration-200"
          name="username"
          id="username"
          type="text"
          placeholder="Choose a username"
          required
          autocomplete="username"
          minlength="3"
          maxlength="30"
        />
      </div>

      <div>
        <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="password">
          Password
        </label>
        <input
          class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-sm text-white placeholder-gray-500 focus:outline-hidden transition duration-200"
          name="password"
          id="password"
          type="password"
          placeholder="••••••••"
          required
          autocomplete="new-password"
          minlength="8"
        />
      </div>

      <div>
        <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="confirmPassword">
          Confirm Password
        </label>
        <input
          class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-sm text-white placeholder-gray-500 focus:outline-hidden transition duration-200"
          name="confirmPassword"
          id="confirmPassword"
          type="password"
          placeholder="••••••••"
          required
          autocomplete="new-password"
          minlength="8"
        />
      </div>

      <button
        class="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-4 rounded-sm transition duration-200 transform hover:scale-105 uppercase tracking-wider"
        type="submit"
      >
        Create Account
      </button>
    </form>

    ${flash.error && flash.error.length ? `<p class="text-red-500 text-sm mt-4 text-center flash-message" data-flash="error">${escapeHtml(flash.error[0])}</p>` : ''}

    <div class="mt-8 pt-6 border-t border-gray-800">
      <p class="text-center text-gray-500 text-sm">
        Already have an account?
        <a href="/login" class="text-red-500 hover:text-red-400 font-semibold transition duration-200">Return to login</a>
      </p>
    </div>
  </div>
 `,
      'Join SuShe Online',
      null
    );

  const loginTemplate = (req, flash) =>
    loginSnippetFn({ req, flash, csrfToken: req.csrfToken() });

  const forgotPasswordTemplate = (req, flash) => `
  <div class="bg-gray-900/90 backdrop-blur-xs border border-gray-800 rounded-lg p-8 shadow-2xl">
    <div class="text-center mb-8">
      <h1 class="metal-title text-3xl font-bold text-red-600 mb-2">Forgot password</h1>
    </div>

    <form method="post" action="/forgot" class="space-y-6">
      <input type="hidden" name="_csrf" value="${req.csrfToken()}" />
      <div>
        <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="email">
          Email Address
        </label>
        <input
          class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-sm text-white placeholder-gray-500 focus:outline-hidden transition duration-200"
          name="email"
          id="email"
          type="email"
          placeholder="your@email.com"
          required
        />
      </div>
      <button
        class="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-4 rounded-sm transition duration-200 transform hover:scale-105 uppercase tracking-wider"
        type="submit"
      >
        Reset password
      </button>
    </form>

    ${flash.info && flash.info.length ? `<p class="text-blue-400 text-sm mt-4 text-center flash-message" data-flash="info">${escapeHtml(flash.info[0])}</p>` : ''}
    ${flash.error && flash.error.length ? `<p class="text-red-500 text-sm mt-4 text-center flash-message" data-flash="error">${escapeHtml(flash.error[0])}</p>` : ''}

    <div class="mt-8 pt-6 border-t border-gray-800">
      <p class="text-center text-gray-500 text-sm">
        <a href="/login" class="text-red-500 hover:text-red-400 font-semibold transition duration-200">Return to login</a>
      </p>
    </div>
  </div>
`;

  const resetPasswordTemplate = (token, csrfToken = '') => `
  <div class="bg-gray-900/90 backdrop-blur-xs border border-gray-800 rounded-lg p-8 shadow-2xl">
    <div class="text-center mb-8">
      <h1 class="metal-title text-3xl font-bold text-red-600 mb-2">Reset Your Password</h1>
      <p class="text-gray-400 text-sm">Create a new password for your account</p>
    </div>

    <form method="post" action="/reset/${token}" class="space-y-6">
      <input type="hidden" name="_csrf" value="${csrfToken}" />
      <div>
        <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="password">
          New Password
        </label>
        <input
          class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-sm text-white placeholder-gray-500 focus:outline-hidden transition duration-200"
          name="password"
          id="password"
          type="password"
          placeholder="••••••••"
          required
          minlength="8"
        />
      </div>
      <button
        class="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-4 rounded-sm transition duration-200 transform hover:scale-105 uppercase tracking-wider"
        type="submit"
      >
        Reset Password
      </button>
    </form>
  </div>
`;

  const invalidTokenTemplate = () => `
  <div class="bg-gray-900/90 backdrop-blur-xs border border-gray-800 rounded-lg p-8 shadow-2xl">
    <p class="text-red-500 text-center mb-4">This password reset link has expired or is invalid</p>
    <a href="/forgot" class="block text-center text-red-500 hover:text-red-400 font-semibold">Request a new reset link</a>
  </div>
`;

  return {
    headerComponent,
    registerTemplate,
    loginTemplate,
    forgotPasswordTemplate,
    resetPasswordTemplate,
    invalidTokenTemplate,
  };
}

module.exports = {
  createAuthTemplates,
};
