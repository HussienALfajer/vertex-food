import { afterEach, describe, expect, it, vi } from 'vitest';

// The client takes `fetch` and `Request` when it is created: stubbed before the module loads. The
// console's requests go to its own origin, which Node has not: relative URLs resolve on a stand-in.
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);
vi.stubGlobal(
  'Request',
  class extends Request {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === 'string' ? new URL(input, 'http://console.test') : input, init);
    }
  },
);
const { api, watchSession } = await import('./api');
const { enterIdentity } = await import('./identity-scope');

function refusal(code: string): { response: Promise<Response>; answer: () => void } {
  let answer = () => {};
  const response = new Promise<Response>((resolve) => {
    answer = () => resolve(Response.json({ code, message: 'Refused.' }, { status: 401 }));
  });
  return { response, answer };
}

afterEach(() => {
  enterIdentity(null);
  fetchMock.mockReset();
});

describe('watchSession', () => {
  it("ends the current user's session on their request's refusal", async () => {
    const ended = vi.fn();
    watchSession(ended);
    enterIdentity('user-a');
    const ending = refusal('SESSION_ENDED');
    fetchMock.mockReturnValueOnce(ending.response);
    const request = api.GET('/api/console/me');
    ending.answer();
    await request;
    expect(ended).toHaveBeenCalledWith('SESSION_ENDED');
  });

  it('never ends anything on a refused sign-in step', async () => {
    const ended = vi.fn();
    watchSession(ended);
    const ending = refusal('UNAUTHENTICATED');
    fetchMock.mockReturnValueOnce(ending.response);
    const request = api.POST('/api/console/auth/totp', {
      body: { ticket: 'ticket', code: '123456' },
    });
    ending.answer();
    await request;
    expect(ended).not.toHaveBeenCalled();
  });

  it("never ends the next user's session on a former user's late refusal", async () => {
    const ended = vi.fn();
    watchSession(ended);
    enterIdentity('user-a');
    const ending = refusal('SESSION_ENDED');
    fetchMock.mockReturnValueOnce(ending.response);
    const request = api.GET('/api/console/me');
    enterIdentity(null);
    enterIdentity('user-b');
    ending.answer();
    const settled = await Promise.race([
      request.then(() => 'settled'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 20)),
    ]);
    expect(settled).toBe('pending');
    expect(ended).not.toHaveBeenCalled();
  });
});
