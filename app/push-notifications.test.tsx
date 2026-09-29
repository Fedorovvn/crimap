import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {IncidentsView} from './incidents-view';
import {detectPushSupport} from './push-support';

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.setItem('crime-map-language', 'ru');
  window.localStorage.setItem('crime-map-safety-notice-v1', 'accepted');
  vi.stubGlobal('matchMedia', (query: string) => ({matches:false, media:query, addEventListener:vi.fn(), removeEventListener:vi.fn()}));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear(); });

function mockPush(permission: NotificationPermission = 'default') {
  const calls: string[] = [];
  const requestPermission = vi.fn(async () => { calls.push('permission'); return 'granted'; });
  const subscription = {toJSON: () => ({endpoint:'https://push.test/subscription',keys:{auth:'a',p256dh:'b'}})};
  const registration = {pushManager:{getSubscription:vi.fn(async () => null),subscribe:vi.fn(async () => subscription)}};
  const register = vi.fn(async () => { calls.push('register'); return registration; });
  vi.stubGlobal('Notification', {permission, requestPermission});
  vi.stubGlobal('PushManager', function() {});
  vi.stubGlobal('navigator', {userAgent:'Desktop Chrome', languages:['ru-RU'], maxTouchPoints:0, serviceWorker:{getRegistration:vi.fn(async () => undefined), register, ready:Promise.resolve(registration)}});
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ok:true,json:async () => url === '/api/push/config' ? {enabled:true,publicKey:'AQID',cities:['Budapest']} : {incidents:[]}})));
  return {calls, requestPermission, register, registration};
}

describe('notification entry flow', () => {
  it('detects iPhone browsers, desktop-mode iPads, installed iOS apps and Android support', () => {
    const env = {userAgent:'iPhone CriOS',maxTouchPoints:5,standalone:false,serviceWorker:true,pushManager:true,notifications:true};
    expect(detectPushSupport(env)).toBe('install-required');
    expect(detectPushSupport({...env,userAgent:'Macintosh',maxTouchPoints:5})).toBe('install-required');
    expect(detectPushSupport({...env,standalone:true})).toBe('supported');
    expect(detectPushSupport({...env,standalone:true,pushManager:false})).toBe('unsupported');
    expect(detectPushSupport({...env,userAgent:'Android Chrome'})).toBe('supported');
    expect(detectPushSupport({...env,userAgent:'Desktop',notifications:false})).toBe('unsupported');
  });
  it('shows installation steps on the first iPhone bell click without requesting permission', async () => {
    const mocks=mockPush();
    vi.stubGlobal('navigator', {...navigator,userAgent:'Mozilla iPhone CriOS'});
    render(<IncidentsView incidents={[]} />);
    await userEvent.setup().click(screen.getByRole('button',{name:'Настроить уведомления'}));
    expect(screen.getByRole('dialog',{name:'Уведомления на iPhone и iPad'})).toBeTruthy();
    expect(screen.getByText(/Выберите «На экран Домой»/)).toBeTruthy();
    expect(mocks.requestPermission).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it('requests permission directly on click, subscribes, and keeps settings and opt-out available', async () => {
    const mocks=mockPush();
    const user=userEvent.setup();
    render(<IncidentsView incidents={[]} />);
    expect(mocks.requestPermission).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button',{name:'Настроить уведомления'}));
    await screen.findByText('Уведомления о новых событиях включены');
    expect(mocks.calls).toEqual(['permission','register']);
    expect(mocks.registration.pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button',{name:'Отключить уведомления'})).toBeTruthy();
    expect(screen.getByText('Какие события присылать')).toBeTruthy();
    await user.click(screen.getByRole('button',{name:'Закрыть'}));
    await user.click(screen.getByRole('button',{name:'Настроить уведомления'}));
    expect(mocks.requestPermission).toHaveBeenCalledTimes(1);
  });
  it('explains a browser block without retrying permission or starting a subscription', async () => {
    const mocks=mockPush('denied');
    render(<IncidentsView incidents={[]} />);
    await userEvent.setup().click(screen.getByRole('button',{name:'Настроить уведомления'}));
    await waitFor(() => expect(screen.getByText(/Уведомления заблокированы/)).toBeTruthy());
    expect(mocks.requestPermission).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });
});
