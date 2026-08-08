(() => {
  'use strict';

  async function initialize() {
    const setup = document.getElementById('auth-setup');
    const target = document.getElementById('clerk-sign-in');
    const redirectUrl = new URLSearchParams(location.search).get('redirect_url') || '/app.html';
    const config = await window.MeasurementStack.ready;
    const auth = await window.MeasurementStack.loadClerk();

    window.MeasurementStack.track('view_sign_in', { auth_configured: Boolean(config.clerkPublishableKey) });

    if (!config.clerkPublishableKey) {
      setup.innerHTML = '<strong>Clerk setup required</strong><p>Add CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY in Cloudflare to activate sign-up and sign-in.</p>';
      return;
    }
    if (!auth.clerk) {
      setup.innerHTML = `<strong>Authentication could not load</strong><p>${window.MeasurementStack.escapeHtml(auth.error || 'Check the Clerk keys and allowed domain.')}</p>`;
      return;
    }
    if (auth.clerk.isSignedIn) {
      await window.MeasurementStack.syncIdentity();
      location.replace(redirectUrl);
      return;
    }

    setup.hidden = true;
    auth.clerk.mountSignIn(target, {
      afterSignInUrl: redirectUrl,
      afterSignUpUrl: redirectUrl,
      signUpUrl: '/sign-in.html'
    });
  }

  initialize();
})();
