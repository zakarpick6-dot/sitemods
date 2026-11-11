/* REVOMAKER STEAM — owner sign in */
(function () {
  'use strict';

  const RV = window.RV;
  if (!RV) return;

  const { $ } = RV;

  const form = $('#loginForm');
  const email = $('#email');
  const password = $('#password');
  const submit = $('#loginSubmit');
  const errorBox = $('#loginError');
  const errorText = $('#loginErrorText');
  const warning = $('#setupWarning');
  const toggle = $('#togglePassword');

  function setFieldError(field, message) {
    const wrapper = field === 'email' ? $('#emailField') : field === 'password' ? $('#passwordField') : null;
    if (!wrapper) return;
    wrapper.classList.toggle('has-error', Boolean(message));
    const node = wrapper.querySelector('.field-error');
    if (node && message) node.textContent = message;
  }

  function clearErrors() {
    setFieldError('email', '');
    setFieldError('password', '');
    errorBox.hidden = true;
  }

  function showError(message) {
    errorText.textContent = message;
    errorBox.hidden = false;
  }

  function loading(on) {
    submit.classList.toggle('is-loading', on);
    submit.disabled = on;
    email.disabled = on;
    password.disabled = on;
  }

  toggle?.addEventListener('click', () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    toggle.setAttribute('title', show ? 'Hide password' : 'Show password');
    password.focus({ preventScroll: true });
  });

  [email, password].forEach((input) => {
    input?.addEventListener('input', () => {
      const field = input === email ? 'email' : 'password';
      setFieldError(field, '');
      errorBox.hidden = true;
    });
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();

    const emailValue = email.value.trim();
    const passwordValue = password.value;

    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(emailValue)) {
      setFieldError('email', 'Enter a valid email address.');
      email.focus();
      return;
    }
    if (passwordValue.length < 12) {
      setFieldError('password', 'Password must be at least 12 characters.');
      password.focus();
      return;
    }

    loading(true);
    try {
      await RV.api.auth.login(emailValue, passwordValue);
      submit.querySelector('span')?.remove();
      window.location.replace('/admin');
    } catch (error) {
      loading(false);
      if (error.code === 'rate_limited') {
        const seconds = Number(error.retryAfter) || 900;
        const minutes = Math.max(1, Math.ceil(seconds / 60));
        showError(`Too many sign-in attempts. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`);
      } else if (error.field === 'email') {
        setFieldError('email', error.message);
      } else if (error.field === 'password') {
        setFieldError('password', error.message);
      } else if (error.code === 'unauthenticated' || error.status === 401) {
        showError('Invalid email or password.');
      } else {
        showError(error.message || 'Could not sign in. Try again.');
      }
    }
  });

  RV.api
    .setupStatus()
    .then((status) => {
      if (status && status.ready === false) {
        warning.hidden = false;
        submit.disabled = true;
        submit.textContent = 'Awaiting owner setup';
      }
    })
    .catch(() => {
      /* setup status is informative only */
    });

  setTimeout(() => {
    if (email && !email.disabled) email.focus({ preventScroll: true });
  }, 60);
})();
