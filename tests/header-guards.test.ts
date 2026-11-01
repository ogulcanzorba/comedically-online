import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { menuLinks, initialsFor } from '../src/components/UserMenu';
import { middleware } from '../src/middleware';

describe('header menu', () => {
  it('viewers get profile + tickets links', () => {
    assert.deepEqual(menuLinks('viewer'), [
      { label: 'My profile', href: '/profile' },
      { label: 'My tickets', href: '/profile#tickets' },
    ]);
  });

  it('comedians get profile + studio links', () => {
    assert.deepEqual(menuLinks('comedian'), [
      { label: 'My profile', href: '/profile' },
      { label: 'Studio', href: '/studio' },
    ]);
  });

  it('derives avatar initials', () => {
    assert.equal(initialsFor('Ada Larkspur'), 'AL');
    assert.equal(initialsFor('Madonna'), 'MA');
    assert.equal(initialsFor('  ren   ishida  '), 'RI');
    assert.equal(initialsFor(''), '?');
  });
});

describe('route guards', () => {
  function req(path: string, cookie?: string): NextRequest {
    const headers = new Headers();
    if (cookie) headers.set('cookie', cookie);
    return new NextRequest(`http://localhost${path}`, { headers });
  }

  it('sends logged-out /profile visitors to login with ?next=', () => {
    const res = middleware(req('/profile'));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get('location'), 'http://localhost/login?next=%2Fprofile');
  });

  it('sends logged-out /studio visitors to login with ?next=', () => {
    const res = middleware(req('/studio/shows'));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get('location'), 'http://localhost/login?next=%2Fstudio%2Fshows');
  });

  it('lets requests with a session cookie through', () => {
    const res = middleware(req('/profile', 'comedically_session=abc.def.ghi'));
    assert.equal(res.headers.get('x-middleware-next'), '1');
  });
});
