self.addEventListener('push',event=>{
  const payload=event.data?event.data.json():{};
  event.waitUntil(self.registration.showNotification(payload.title||'Crime Map · Редактор',{
    body:payload.body||'',tag:payload.tag||'crimap-editor',data:{url:payload.url||'/admin/'},icon:'/brand/v2/icon-192.png',badge:'/brand/v2/badge.png',renotify:true,
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();const destination=new URL(event.notification.data?.url||'/admin/',self.location.origin).href;
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{
    const existing=windows.find(window=>new URL(window.url).pathname.startsWith('/admin/'));
    return existing?existing.focus().then(()=>existing.navigate(destination)):clients.openWindow(destination);
  }));
});
