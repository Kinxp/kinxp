import type { ApiRequest, ApiResponse } from './types';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const query = url.search;

  // Hedera target
  const targetUrl = `https://hedera.cloud.blockscout.com/api${query}`;

  try {
    const response = await fetch(targetUrl);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch from Hedera proxy' });
  }
}