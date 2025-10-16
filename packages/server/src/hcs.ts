export async function hcsPublish(topicId: string, message: any){
  // TODO: use Hedera SDK to publish to Consensus Service (HCS)
  return { ok: true, topicId, message, ts: Date.now() };
}
