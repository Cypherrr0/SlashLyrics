import assert from 'node:assert/strict';
import { parseLatestPlayerArtwork, parseNeteaseHistoryRows } from '../../src/player/netease';

describe('NetEase fallback parsing', () => {
    it('selects the latest 600px player artwork request from the CEF log', () => {
        const text = [
            '[0716/110956.029543:INFO:ResourceHandler.mm(87)] ResourceHandler::Open request_id=1 method=GET url=http://p4.music.126.net/oldKey==/1.jpg?xnos=1&imageView=&thumbnail=600y600',
            '[0716/111316.402781:INFO:ResourceHandler.mm(87)] ResourceHandler::Open request_id=2 method=GET url=http://p4.music.126.net/newKey_-==/2.jpg?xnos=1&imageView=&thumbnail=600y600',
        ].join('\n');
        const now = new Date(2026, 6, 16, 11, 20, 0).getTime();

        const result = parseLatestPlayerArtwork(text, now);

        assert.deepEqual(result, {
            key: 'newKey_-==',
            startedAt: new Date(2026, 6, 16, 11, 13, 16).getTime(),
        });
    });

    it('rejects an old history row instead of pinning its final lyric', () => {
        const duration = 180_000;
        const playtime = new Date(2026, 6, 16, 10, 0, 0).getTime();
        const now = new Date(2026, 6, 16, 11, 0, 0).getTime();
        const stdout = JSON.stringify([{
            playtime,
            id: '123',
            jsonStr: JSON.stringify({
                id: '123',
                name: 'Old Track',
                duration,
                artists: [{ name: 'Artist' }],
            }),
        }]);

        const result = parseNeteaseHistoryRows(stdout, now);

        assert.equal(result.track, null);
        assert.equal(result.reason, 'history row is stale');
    });
});
