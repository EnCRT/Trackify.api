/**
 * Custom route for Google mobile sign-in.
 * POST /api/auth/google/mobile — public endpoint.
 */
export default {
  routes: [
    {
      method: 'POST',
      path: '/auth/google/mobile',
      handler: 'auth.googleMobile',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/auth/refresh',
      handler: 'auth.refresh',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/auth/logout',
      handler: 'auth.logout',
      config: {
        auth: false,
        policies: [],
      },
    },
  ],
};

