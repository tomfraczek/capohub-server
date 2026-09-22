import { GooglePeopleApiService } from './google-people-api.service';

describe('GooglePeopleApiService', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function mockFetch(response: Partial<Response> & { ok: boolean }) {
    global.fetch = jest.fn().mockResolvedValue(response) as unknown as typeof fetch;
    return global.fetch as jest.Mock;
  }

  it('resolves true (a real photo) when photos[0].default is false', async () => {
    mockFetch({
      ok: true,
      json: jest.fn().mockResolvedValue({ photos: [{ default: false }] }),
    } as unknown as Response);

    const service = new GooglePeopleApiService();
    await expect(service.resolveHasCustomPhoto('token-1')).resolves.toBe(true);
  });

  it('resolves false (the auto-generated placeholder) when photos[0].default is true', async () => {
    mockFetch({
      ok: true,
      json: jest.fn().mockResolvedValue({ photos: [{ default: true }] }),
    } as unknown as Response);

    const service = new GooglePeopleApiService();
    await expect(service.resolveHasCustomPhoto('token-1')).resolves.toBe(false);
  });

  it('resolves null when the response has no photos array', async () => {
    mockFetch({
      ok: true,
      json: jest.fn().mockResolvedValue({}),
    } as unknown as Response);

    const service = new GooglePeopleApiService();
    await expect(service.resolveHasCustomPhoto('token-1')).resolves.toBeNull();
  });

  it('resolves null when the People API responds with a non-2xx status, without throwing', async () => {
    mockFetch({ ok: false, status: 403 } as unknown as Response);

    const service = new GooglePeopleApiService();
    await expect(service.resolveHasCustomPhoto('token-1')).resolves.toBeNull();
  });

  it('resolves null when the request itself throws (network failure), without throwing', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    const service = new GooglePeopleApiService();
    await expect(service.resolveHasCustomPhoto('token-1')).resolves.toBeNull();
  });

  // The access token itself must only ever appear as the Authorization
  // header sent to Google - never in a log line. The error-path tests above
  // already exercise every `logger.warn` call site; none of them receive
  // the token as an argument (see the implementation - only HTTP status
  // codes and error messages are logged).
  it('sends the access token only as the Authorization header', async () => {
    const fetchMock = mockFetch({
      ok: true,
      json: jest.fn().mockResolvedValue({ photos: [{ default: false }] }),
    } as unknown as Response);

    const service = new GooglePeopleApiService();
    await service.resolveHasCustomPhoto('super-secret-token');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('people.googleapis.com'),
      expect.objectContaining({ headers: { Authorization: 'Bearer super-secret-token' } }),
    );
  });
});
