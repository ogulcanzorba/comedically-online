import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isShowOwner, ownerPurchaseBlockReason, ticketSectionMode } from '../src/lib/show-access';

const SHOW = { comedian_id: 'comic-ada' };

describe('isShowOwner', () => {
  it('matches only the owning comedian id', () => {
    assert.equal(isShowOwner('comic-ada', SHOW), true);
    assert.equal(isShowOwner('viewer-riley', SHOW), false);
    assert.equal(isShowOwner('comic-other', SHOW), false);
  });

  it('is never true for logged-out viewers', () => {
    assert.equal(isShowOwner(null, SHOW), false);
    assert.equal(isShowOwner(undefined, SHOW), false);
    assert.equal(isShowOwner('', SHOW), false);
  });
});

describe('ticketSectionMode (show page UI variant)', () => {
  it('shows the owner panel instead of Buy/Claim for the owner', () => {
    assert.equal(ticketSectionMode({ isOwner: true, ticketHeld: false }), 'owner');
  });

  it('keeps the normal flow for viewers and other comedians', () => {
    assert.equal(ticketSectionMode({ isOwner: false, ticketHeld: false }), 'buy');
    assert.equal(ticketSectionMode({ isOwner: false, ticketHeld: true }), 'held');
  });

  it('prefers the owner panel even when a legacy ticket row exists', () => {
    assert.equal(ticketSectionMode({ isOwner: true, ticketHeld: true }), 'owner');
  });
});

describe('ownerPurchaseBlockReason (tickets API guard)', () => {
  it('blocks the owning comedian', () => {
    const reason = ownerPurchaseBlockReason('comic-ada', SHOW);
    assert.ok(typeof reason === 'string' && reason.length > 0);
    assert.match(reason, /own show/);
  });

  it('allows viewers and other comedians', () => {
    assert.equal(ownerPurchaseBlockReason('viewer-riley', SHOW), null);
    assert.equal(ownerPurchaseBlockReason('comic-other', SHOW), null);
  });
});
