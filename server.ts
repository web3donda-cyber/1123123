import express from 'express';
import path from 'path';
import 'dotenv/config';
import { createServer as createViteServer } from 'vite';
import { productsList, reviewsList } from './src/data.js';
import {
  collection,
  getDocs,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  query,
  getDocFromServer
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './src/firebase-server.js';

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: true }));

// 1. Mock orders for fallback/seeding
interface Order {
  orderId: string;
  customerName: string;
  customerPhone: string;
  deliveryType: 'delivery' | 'pickup';
  address?: string;
  date?: string;
  time?: string;
  cardMessage?: string;
  totalPrice: number;
  items: {
    productId: string;
    name: string;
    quantity: number;
    price: number;
  }[];
  status: 'pending' | 'assembling' | 'assembled' | 'delivering' | 'delivered' | 'cancelled';
  statusLog: { status: string; timestamp: string; note: string }[];
  createdAt: string;
  paymentMethod?: 'cash' | 'yookassa' | string;
  paymentStatus?: 'unpaid' | 'paid' | 'pending_confirmation' | string;
}

const mockOrdersList: Order[] = [
  {
    orderId: 'ELZ-482103',
    customerName: 'Анна Петрова',
    customerPhone: '+7 (912) 345-67-89',
    deliveryType: 'delivery',
    address: 'г. Челябинск, ул. Ленина, д. 45, кв. 112',
    date: 'Сегодня',
    time: '14:00 - 16:00',
    cardMessage: 'Любимой мамочке в день рождения!',
    totalPrice: 3885,
    items: [
      { productId: 'flower-1', name: 'Роза Нина Эквадор', quantity: 15, price: 220 },
      { productId: 'green-1', name: 'Эвкалипт', quantity: 3, price: 150 }
    ],
    status: 'delivered',
    statusLog: [
      { status: 'pending', timestamp: '22 Мая, 11:20', note: 'Заказ успешно принят на сайте' },
      { status: 'assembling', timestamp: '22 Мая, 11:45', note: 'Наши флористы начали сборку вашего букета из элитных сортов' },
      { status: 'assembled', timestamp: '22 Мая, 12:30', note: 'Букет собран на воде, бережно упакован в премиум-крафт и готов к отправке' },
      { status: 'delivering', timestamp: '22 Мая, 13:10', note: 'Заказ передан курьеру, перевозится в специальной термосумке по Челябинску' },
      { status: 'delivered', timestamp: '22 Мая, 14:15', note: 'Букет успешно и красиво вручен получателю! Свежесть гарантирована ✨' }
    ],
    createdAt: '2026-05-22T11:20:00.000Z'
  },
  {
    orderId: 'ELZ-872911',
    customerName: 'Михаил Сидоров',
    customerPhone: '+7 (922) 765-43-21',
    deliveryType: 'delivery',
    address: 'г. Челябинск, ул. Труда, д. 84, кв. 11',
    date: 'Сегодня',
    time: '18:00 - 20:00',
    cardMessage: 'Ты для меня целый мир. С годовщиной!',
    totalPrice: 2843,
    items: [
      { productId: 'flower-4', name: 'Роза пионовидная Кантри Блюз', quantity: 11, price: 220 },
      { productId: 'green-1', name: 'Эвкалипт', quantity: 2, price: 150 }
    ],
    status: 'delivering',
    statusLog: [
      { status: 'pending', timestamp: '22 Мая, 14:05', note: 'Заказ принят на сайте, формируется ведомость сборки' },
      { status: 'assembling', timestamp: '22 Мая, 14:30', note: 'Наши флористы подбирают пышные бутоны пионовидных роз' },
      { status: 'assembled', timestamp: '22 Мая, 15:20', note: 'Букет собран на воде, упакован в дизайнерскую кальку' },
      { status: 'delivering', timestamp: '22 Мая, 15:55', note: 'Курьер бережно везет самый красивый букет по Челябинску' }
    ],
    createdAt: '2026-05-22T14:05:00.000Z'
  },
  {
    orderId: 'ELZ-230198',
    customerName: 'Елена Котова',
    customerPhone: '+7 (900) 123-45-67',
    deliveryType: 'pickup',
    address: 'Самовывоз (Челябинск, ул. Масленникова, д. 6/1)',
    date: 'Сегодня',
    time: '19:30',
    cardMessage: 'Весенний привет от близких!',
    totalPrice: 2400,
    items: [
      { productId: 'flower-5', name: 'Лилия', quantity: 3, price: 650 },
      { productId: 'green-1', name: 'Эвкалипт', quantity: 3, price: 150 }
    ],
    status: 'assembling',
    statusLog: [
      { status: 'pending', timestamp: '22 Мая, 15:40', note: 'Заказ успешно оформлен и ожидает сборки' },
      { status: 'assembling', timestamp: '22 Мая, 15:55', note: 'Начался процесс бережной сборки ароматных лилий' }
    ],
    createdAt: '2026-05-22T15:40:00.000Z'
  }
];

// Retrieve helper to get actual date string
function getFormattedDate() {
  const d = new Date();
  const months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
  const day = d.getDate();
  const month = months[d.getMonth()];
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${month}, ${hours}:${minutes}`;
}

// 2. API: PLACE AN ORDER
app.post('/api/order', async (req, res) => {
  const { customerName, customerPhone, deliveryType, address, cardMessage, totalPrice, items, date, time, paymentMethod } = req.body;

  if (!customerName || !customerPhone) {
    return res.status(400).json({ error: 'Пожалуйста, заполните имя и номер телефона.' });
  }

  const orderId = `ELZ-${Math.floor(100000 + Math.random() * 900000)}`;
  const finalPaymentMethod = paymentMethod || 'cash';
  const finalPaymentStatus = req.body.paymentStatus || (finalPaymentMethod === 'yookassa' ? 'unpaid' : 'pending_confirmation');
  
  const statusNote = finalPaymentMethod === 'yookassa'
    ? (finalPaymentStatus === 'paid' ? 'Оформлено на сайте. Оплачено онлайн через ЮKassa ✨' : 'Оформлено на сайте. Ожидает онлайн-оплаты через сервис ЮKassa.')
    : 'Оформлено на сайте. Менеджер свяжется с вами для подтверждения.';

  const newOrder: Order = {
    orderId,
    customerName,
    customerPhone,
    deliveryType: deliveryType || 'delivery',
    address: address || (deliveryType === 'pickup' ? 'Самовывоз (ул. Масленникова, д. 6/1)' : 'Челябинск'),
    date: date || 'Сегодня',
    time: time || 'В ближайшие 2 часа',
    cardMessage: cardMessage || '',
    totalPrice: totalPrice || 0,
    items: items || [],
    status: 'pending',
    statusLog: [
      { status: 'pending', timestamp: getFormattedDate(), note: statusNote }
    ],
    createdAt: new Date().toISOString(),
    paymentMethod: finalPaymentMethod,
    paymentStatus: finalPaymentStatus
  };

  const pathForWrite = 'orders';
  try {
    await setDoc(doc(db, pathForWrite, orderId), newOrder);
  } catch (error) {
    console.warn('Firestore write failed, saving order to local in-memory fallback list:', error);
  }
  
  // Keep synced in fallback mock array
  mockOrdersList.unshift(newOrder);

  const responseData = {
    success: true,
    orderId,
    paymentMethod: finalPaymentMethod,
    paymentStatus: finalPaymentStatus,
    totalPrice: newOrder.totalPrice,
    message: finalPaymentMethod === 'yookassa'
      ? `Спасибо, ${customerName}! Заказ успешно сформирован и ожидает онлайн-оплаты. Пожалуйста, внесите оплату для передачи заказа флористам.`
      : (deliveryType === 'delivery'
        ? `Спасибо, ${customerName}! Заказ на доставку успешно оформлен. Наш менеджер в Челябинске свяжется с вами по номеру ${customerPhone} в кратчайшие сроки (до 5 минут) для подтверждения.`
        : `Спасибо, ${customerName}! Ваш заказ оформлен на самовывоз. Ждём вас в нашем салоне на ул. Масленникова, д. 6/1. Всё подготовим вовремя!`)
  };

  res.json(responseData);
});

// 3. API: GET ALL ORDERS (Admin Panel)
app.get('/api/orders', async (req, res) => {
  const pathForGet = 'orders';
  try {
    const snap = await getDocs(collection(db, pathForGet));
    const list = snap.docs.map(d => d.data());
    
    // Merge Firestore list and server memory list so they are 100% in sync
    const mergedMap = new Map();
    mockOrdersList.forEach((ord: any) => {
      mergedMap.set(ord.orderId, ord);
    });
    list.forEach((ord: any) => {
      mergedMap.set(ord.orderId, ord);
    });
    const mergedList = Array.from(mergedMap.values());
    
    // Sort descending by creation timestamp
    mergedList.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json(mergedList);
  } catch (error) {
    console.warn('Firestore fetch orders failed, returning in-memory mockOrdersList instead:', error);
    res.json(mockOrdersList);
  }
});

// 4. API: GET STATIC/DYNAMIC PRODUCTS
app.get('/api/products', async (req, res) => {
  const pathForGet = 'products';
  try {
    const snap = await getDocs(collection(db, pathForGet));
    let list = snap.docs.map(d => d.data());
    if (list.length === 0) {
      list = [...productsList];
    }
    // Robust sorting: prioritize "order" field, fall back to "id" alphabetical
    list.sort((a: any, b: any) => {
      const orderA = a.order !== undefined ? a.order : 9999;
      const orderB = b.order !== undefined ? b.order : 9999;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return (a.id || '').localeCompare(b.id || '');
    });
    res.json(list);
  } catch (error) {
    console.warn('Firestore fetch products failed, returning local productsList fallback:', error);
    res.json(productsList);
  }
});

const defaultCategories = [
  { id: 'flowers', label: 'Цветы поштучно' },
  { id: 'greens', label: 'Декоративная зелень' },
  { id: 'balloons', label: 'Гелиевые шары' },
  { id: 'author', label: 'Авторские букеты' },
  { id: 'roses', label: 'Пионовидные розы' },
  { id: 'spring', label: 'Весенняя коллекция' },
  { id: 'boxes', label: 'Шляпные коробки' }
];

let mockCategories = [...defaultCategories];

// 4.5 API: GET CATEGORIES
app.get('/api/categories', async (req, res) => {
  const pathForGet = 'categories';
  try {
    const snap = await getDocs(collection(db, pathForGet));
    let list = snap.docs.map(d => d.data());
    if (list.length === 0) {
      try {
        for (const cat of defaultCategories) {
          await setDoc(doc(db, pathForGet, cat.id), cat);
        }
      } catch (seedErr) {
        console.warn('Could not seed default categories to Firestore:', seedErr);
      }
      list = [...defaultCategories];
    }
    const mergedMap = new Map();
    mockCategories.forEach((cat: any) => mergedMap.set(cat.id, cat));
    list.forEach((cat: any) => mergedMap.set(cat.id, cat));
    const mergedList = Array.from(mergedMap.values());
    res.json(mergedList);
  } catch (error) {
    console.warn('Firestore fetch categories failed, returning local mockCategories:', error);
    res.json(mockCategories);
  }
});

// 4.6 API: ADD A CATEGORY
app.post('/api/categories', async (req, res) => {
  const { id, label } = req.body;
  if (!id || !label) {
    return res.status(400).json({ error: 'Идентификатор и название категории обязательны.' });
  }

  const newCategory = { id, label };
  const pathForWrite = 'categories';
  try {
    await setDoc(doc(db, pathForWrite, id), newCategory);
  } catch (error) {
    console.warn('Firestore add category failed, adding to mockCategories memory list:', error);
  }

  const exists = mockCategories.some(c => c.id === id);
  if (!exists) {
    mockCategories.push(newCategory);
  }

  res.json({ success: true, category: newCategory });
});

// 4.7 API: DELETE A CATEGORY
app.delete('/api/categories/:id', async (req, res) => {
  const { id } = req.params;
  
  const pathForDelete = 'categories';
  try {
    await deleteDoc(doc(db, pathForDelete, id));
  } catch (error) {
    console.warn(`Firestore delete category ${id} failed:`, error);
  }

  mockCategories = mockCategories.filter(c => c.id !== id);
  res.json({ success: true, message: 'Категория успешно удалена' });
});

// 5. API: ADD A NEW PRODUCT
app.post('/api/products', async (req, res) => {
  const { name, description, price, category, composition, tags, imageSrc, popular, imageClassName } = req.body;
  if (!name || price === undefined) {
    return res.status(400).json({ error: 'Имя и цена товара обязательны.' });
  }

  const id = `prod-${Date.now()}`;
  
  let targetOrder = 999;
  try {
    const snap = await getDocs(collection(db, 'products'));
    targetOrder = snap.size;
  } catch (err) {
    console.warn('Could not determine current products count for position:', err);
    targetOrder = productsList.length;
  }

  const newProduct = {
    id,
    name,
    description: description || '',
    price: Number(price),
    // Use fallback high-quality flower image if no URL is provided
    imageSrc: imageSrc || 'https://images.unsplash.com/photo-1526047932273-341f2a7631f9?q=80&w=600&auto=format&fit=crop',
    category: category || 'flowers',
    composition: Array.isArray(composition) ? composition : (composition ? composition.split(',').map((s: string) => s.trim()) : []),
    tags: Array.isArray(tags) ? tags : (tags ? tags.split(',').map((s: string) => s.trim()) : []),
    rating: 5.0,
    popular: !!popular,
    imageClassName: imageClassName || 'object-cover',
    order: targetOrder
  };

  const pathForWrite = 'products';
  try {
    await setDoc(doc(db, pathForWrite, id), newProduct);
  } catch (error) {
    console.warn('Firestore add product failed, adding to in-memory productsList copy:', error);
  }
  
  // Keep in-memory cache synced
  const existsIdx = productsList.findIndex(p => p.id === id);
  if (existsIdx === -1) {
    productsList.push(newProduct as any);
  }

  res.json({ success: true, product: newProduct });
});

// 6. API: UPDATE PRODUCT DETAILS
app.put('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description, price, category, composition, tags, imageSrc, popular, imageClassName, order } = req.body;

  const pathForWrite = 'products';
  let updatedProduct: any = null;

  try {
    const docRef = doc(db, pathForWrite, id);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const existingProduct = docSnap.data();
      updatedProduct = {
        ...existingProduct,
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(price !== undefined && { price: Number(price) }),
        ...(category !== undefined && { category }),
        ...(composition !== undefined ? { composition: Array.isArray(composition) ? composition : composition.split(',').map((s: string) => s.trim()) } : {}),
        ...(tags !== undefined ? { tags: Array.isArray(tags) ? tags : tags.split(',').map((s: string) => s.trim()) } : {}),
        ...(imageSrc !== undefined && { imageSrc }),
        ...(popular !== undefined && { popular: !!popular }),
        ...(imageClassName !== undefined && { imageClassName }),
        ...(order !== undefined && { order: Number(order) })
      };
      await setDoc(docRef, updatedProduct);
    }
  } catch (error) {
    console.warn('Firestore update products failed, performing update in local in-memory fallback list:', error);
  }

  // Sync update to in-memory list
  const idx = productsList.findIndex(p => p.id === id);
  if (idx !== -1) {
    productsList[idx] = {
      ...productsList[idx],
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(price !== undefined && { price: Number(price) }),
      ...(category !== undefined && { category }),
      ...(composition !== undefined ? { composition: Array.isArray(composition) ? composition : composition.split(',').map((s: string) => s.trim()) } : {}),
      ...(tags !== undefined ? { tags: Array.isArray(tags) ? tags : tags.split(',').map((s: string) => s.trim()) } : {}),
      ...(imageSrc !== undefined && { imageSrc }),
      ...(popular !== undefined && { popular: !!popular }),
      ...(imageClassName !== undefined && { imageClassName }),
      ...(order !== undefined && { order: Number(order) })
    } as any;
    if (!updatedProduct) {
      updatedProduct = productsList[idx];
    }
  }

  if (updatedProduct) {
    res.json({ success: true, product: updatedProduct });
  } else {
    res.status(404).json({ error: 'Товар не найден.' });
  }
});

// 6.5 API: REORDER PRODUCTS
app.post('/api/products/reorder', async (req, res) => {
  const { orders } = req.body;
  if (!orders || !Array.isArray(orders)) {
    return res.status(400).json({ error: 'Массив orders обязателен.' });
  }

  const pathForWrite = 'products';
  try {
    for (const item of orders) {
      if (!item.id) continue;
      const docRef = doc(db, pathForWrite, item.id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const existingProduct = docSnap.data();
        await setDoc(docRef, {
          ...existingProduct,
          order: Number(item.order)
        });
      }
    }
  } catch (error) {
    console.warn('Firestore reorder failed, applying sorting to local in-memory productsList:', error);
  }

  // Synchronize positions in-memory
  for (const item of orders) {
    const p = productsList.find(p => p.id === item.id);
    if (p) {
      p.order = Number(item.order);
    }
  }
  productsList.sort((a, b) => {
    const orderA = a.order !== undefined ? a.order : 9999;
    const orderB = b.order !== undefined ? b.order : 9999;
    return orderA - orderB;
  });

  res.json({ success: true, message: 'Сортировка успешно сохранена.' });
});

// 7. API: DELETE PRODUCT FROM CATALOG
app.delete('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  const pathForWrite = 'products';
  let deletedProduct: any = null;

  try {
    const docRef = doc(db, pathForWrite, id);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      deletedProduct = docSnap.data();
      await deleteDoc(docRef);
    }
  } catch (error) {
    console.warn('Firestore delete failed, deleting from local in-memory productsList:', error);
  }

  const idx = productsList.findIndex(p => p.id === id);
  if (idx !== -1) {
    if (!deletedProduct) {
      deletedProduct = productsList[idx];
    }
    productsList.splice(idx, 1);
  }

  if (deletedProduct) {
    res.json({ success: true, message: 'Товар успешно удален.', product: deletedProduct });
  } else {
    res.status(404).json({ error: 'Товар не найден.' });
  }
});

// 8. API: TRACK INDIVIDUAL ORDER STATUS
app.get('/api/order/:id', async (req, res) => {
  const trackingId = req.params.id.trim();
  const pathForGet = 'orders';
  try {
    const docRef = doc(db, pathForGet, trackingId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return res.json(docSnap.data());
    }

    // Fallback search case-insensitive
    const snap = await getDocs(collection(db, pathForGet));
    const matched = snap.docs.find(d => d.id.toUpperCase() === trackingId.toUpperCase());
    if (matched) {
      return res.json(matched.data());
    }
  } catch (error) {
    console.warn('Firestore order tracking failed, looking up in local in-memory list:', error);
  }

  // Local lookup fallback
  const fallbackMatched = mockOrdersList.find(ord => ord.orderId.toUpperCase() === trackingId.toUpperCase());
  if (fallbackMatched) {
    return res.json(fallbackMatched);
  }

  res.status(404).json({ error: 'Заказ с таким номером не найден. Пожалуйста, проверьте формат ELZ-XXXXXX.' });
});

// 9. API: UPDATE ORDER STATUS (Admin workflow)
app.post('/api/orders/:id/status', async (req, res) => {
  const orderId = req.params.id;
  const { status, note, paymentStatus } = req.body;

  const validStatuses = ['pending', 'assembling', 'assembled', 'delivering', 'delivered', 'cancelled'];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Передан некорректный статус заказа.' });
  }

  const defaultNotes: Record<string, string> = {
    pending: 'Заказ ожидает подтверждения',
    assembling: 'Наши флористы бережно подбирают лучшие бутоны для вашего букета',
    assembled: 'Букет собран, сфотографирован и аккуратно упакован на воде',
    delivering: 'Заказ передан курьеру, перевозится в специальной термосумке по Челябинску',
    delivered: 'Букет успешно вручен получателю! Свежесть 100% ✨',
    cancelled: 'Заказ отменен'
  };

  const pathForWrite = 'orders';
  let targetOrder: any = null;

  try {
    const docRef = doc(db, pathForWrite, orderId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const orderData = docSnap.data();
      const updatedStatusLog = [...(orderData.statusLog || [])];
      
      const newStatus = status || orderData.status || 'pending';
      const finalNote = note || (paymentStatus === 'paid' && orderData.paymentStatus !== 'paid' 
        ? '💵 Оплата заказа успешно подтверждена администратором салона вручную.' 
        : (status ? defaultNotes[status] : 'Статус заказа обновлен.'));

      updatedStatusLog.push({
        status: newStatus,
        timestamp: getFormattedDate(),
        note: finalNote
      });
      targetOrder = {
        ...orderData,
        status: newStatus,
        statusLog: updatedStatusLog
      };
      if (paymentStatus) {
        targetOrder.paymentStatus = paymentStatus;
      }
      await setDoc(docRef, targetOrder);
    } else {
      // Self-healing: if document does not exist in Firestore but exists in mockOrdersList, 
      // write it containing the status or payment update so it is persisted to the database now!
      const localOrder = mockOrdersList.find(ord => ord.orderId === orderId);
      if (localOrder) {
        const newStatus = status || localOrder.status || 'pending';
        const finalNote = note || (paymentStatus === 'paid' && localOrder.paymentStatus !== 'paid' 
          ? '💵 Оплата заказа успешно подтверждена администратором салона вручную.' 
          : (status ? defaultNotes[status] : 'Статус заказа обновлен.'));

        const updatedStatusLog = [...(localOrder.statusLog || [])];
        updatedStatusLog.push({
          status: newStatus,
          timestamp: getFormattedDate(),
          note: finalNote
        });
        localOrder.status = newStatus as any;
        localOrder.statusLog = updatedStatusLog;
        if (paymentStatus) {
          localOrder.paymentStatus = paymentStatus;
        }
        targetOrder = localOrder;
        await setDoc(docRef, targetOrder);
      }
    }
  } catch (error) {
    console.warn('Firestore update order status failed, writing to fallback state:', error);
  }

  const localOrder = mockOrdersList.find(ord => ord.orderId === orderId);
  if (localOrder) {
    const newStatus = status || localOrder.status || 'pending';
    const finalNote = note || (paymentStatus === 'paid' && localOrder.paymentStatus !== 'paid' 
      ? '💵 Оплата заказа успешно подтверждена администратором салона вручную.' 
      : (status ? defaultNotes[status] : 'Статус заказа обновлен.'));

    const updatedStatusLog = [...(localOrder.statusLog || [])];
    if (!updatedStatusLog.some(log => log.note === finalNote && log.status === newStatus)) {
      updatedStatusLog.push({
        status: newStatus,
        timestamp: getFormattedDate(),
        note: finalNote
      });
    }
    localOrder.status = newStatus as any;
    localOrder.statusLog = updatedStatusLog;
    if (paymentStatus) {
      localOrder.paymentStatus = paymentStatus;
    }
    if (!targetOrder) {
      targetOrder = localOrder;
    }
  }

  if (targetOrder) {
    res.json({ success: true, order: targetOrder });
  } else {
    res.status(404).json({ error: 'Заказ не найден.' });
  }
});

// 9.5. API: PAY ORDER ONLINE (YooKassa mockup)
app.post('/api/orders/:id/pay', async (req, res) => {
  const orderId = req.params.id;
  const pathForWrite = 'orders';
  let targetOrder: any = null;

  try {
    const docRef = doc(db, pathForWrite, orderId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const orderData = docSnap.data();
      const updatedStatusLog = [...(orderData.statusLog || [])];
      updatedStatusLog.push({
        status: orderData.status || 'pending',
        timestamp: getFormattedDate(),
        note: '💳 Оплата по карте через ЮKassa успешно принята (Тестовый режим). Заказ передан в работу флористам!'
      });
      targetOrder = {
        ...orderData,
        paymentStatus: 'paid',
        statusLog: updatedStatusLog
      };
      await setDoc(docRef, targetOrder);
    }
  } catch (error) {
    console.warn('Firestore update order payment failed, writing to fallback state:', error);
  }

  const localOrder = mockOrdersList.find(ord => ord.orderId === orderId);
  if (localOrder) {
    const updatedStatusLog = [...(localOrder.statusLog || [])];
    updatedStatusLog.push({
      status: localOrder.status || 'pending',
      timestamp: getFormattedDate(),
      note: '💳 Оплата по карте через ЮKassa успешно принята (Тестовый режим). Заказ передан в работу флористам!'
    });
    localOrder.paymentStatus = 'paid';
    localOrder.statusLog = updatedStatusLog;
    if (!targetOrder) {
      targetOrder = localOrder;
    }
  }

  if (targetOrder) {
    res.json({ success: true, order: targetOrder });
  } else {
    res.status(404).json({ error: 'Заказ не найден.' });
  }
});

// YooKassa Configuration for production-ready IP owner setup
const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID || '1368642';
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY || 'test_uPpi_BSVbne-VBEblmN_KdYO2BaJOZFm96s39w6AvaQ';

const isYooKassaConfigured = () => {
  return YOOKASSA_SHOP_ID.trim().length > 0 && YOOKASSA_SECRET_KEY.trim().length > 0;
};

// Helper to mark orders as paid across memory & Firestore
async function markOrderAsPaid(orderId: string, paymentStatus: string, note: string) {
  let targetOrder: any = null;
  const pathForWrite = 'orders';
  try {
    const docRef = doc(db, pathForWrite, orderId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const orderData = docSnap.data();
      const updatedStatusLog = [...(orderData.statusLog || [])];
      
      if (!updatedStatusLog.some(log => log.note === note)) {
        updatedStatusLog.push({
          status: orderData.status || 'pending',
          timestamp: getFormattedDate(),
          note: note
        });
      }
      
      targetOrder = {
        ...orderData,
        paymentStatus: paymentStatus,
        statusLog: updatedStatusLog
      };
      await setDoc(docRef, targetOrder);
    }
  } catch (error) {
    console.warn('Firestore update payment webhook/sync failed:', error);
  }

  const localOrder = mockOrdersList.find(ord => ord.orderId === orderId);
  if (localOrder) {
    const updatedStatusLog = [...(localOrder.statusLog || [])];
    if (!updatedStatusLog.some(log => log.note === note)) {
      updatedStatusLog.push({
        status: localOrder.status || 'pending',
        timestamp: getFormattedDate(),
        note: note
      });
    }
    localOrder.paymentStatus = paymentStatus;
    localOrder.statusLog = updatedStatusLog;
  }
}

// 9.6. API: CREATE YOOKASSA PAYMENT (Real integration if env credentials set, or simulator indicator)
app.post('/api/yookassa/create-payment', async (req, res) => {
  const { orderId } = req.body;
  if (!orderId) {
    return res.status(400).json({ error: 'orderId is required' });
  }

  let order: any = null;
  try {
    const docSnap = await getDoc(doc(db, 'orders', orderId));
    if (docSnap.exists()) {
      order = docSnap.data();
    }
  } catch (err) {
    console.warn('Firestore order fetch for YooKassa creation failed, falling back to local memory:', err);
  }

  if (!order) {
    order = mockOrdersList.find(o => o.orderId === orderId);
  }

  if (!order) {
    return res.status(404).json({ error: 'Заказ не найден.' });
  }

  if (isYooKassaConfigured()) {
    try {
      const auth = Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString('base64');
      const idempotenceKey = `${orderId}-${Date.now()}`;
      
      const payload = {
        amount: {
          value: `${order.totalPrice}.00`,
          currency: 'RUB'
        },
        capture: true,
        confirmation: {
          type: 'redirect',
          return_url: `${process.env.APP_URL || 'http://localhost:3000'}/order-tracker?id=${orderId}`
        },
        description: `Оплата заказа ${orderId} в Цветочном салоне Елизавета`,
        metadata: {
          orderId: orderId
        }
      };

      const yookassaResponse = await fetch('https://api.yookassa.ru/v3/payments', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Idempotence-Key': idempotenceKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!yookassaResponse.ok) {
        const errorText = await yookassaResponse.text();
        console.error('YooKassa API error details:', errorText);
        throw new Error(`YooKassa error HTTP ${yookassaResponse.status}`);
      }

      const paymentData = await yookassaResponse.json() as any;
      
      // Persist payment ID
      try {
        const docRef = doc(db, 'orders', orderId);
        await setDoc(docRef, {
          ...order,
          yookassaPaymentId: paymentData.id,
          paymentStatus: 'pending_confirmation'
        }, { merge: true });
      } catch (e) {
        console.warn('Could not save YooKassa payment id to Firestore:', e);
      }

      const loc = mockOrdersList.find(o => o.orderId === orderId);
      if (loc) {
        (loc as any).yookassaPaymentId = paymentData.id;
        loc.paymentStatus = 'pending_confirmation';
      }

      console.log(`[YooKassa Real Pay] Created transaction ${paymentData.id} for order ${orderId}`);
      return res.json({
        success: true,
        realPayment: true,
        confirmationUrl: paymentData.confirmation?.confirmation_url,
        paymentId: paymentData.id
      });
    } catch (apiError: any) {
      console.error('Failed to communicate with YooKassa API:', apiError);
      return res.status(500).json({ error: 'Ошибка создания транзакции в шлюзе ЮKassa: ' + apiError.message });
    }
  } else {
    // If not configured, run in beautiful preview simulation mode (as default)
    console.log(`[YooKassa Preview Pay] YooKassa is not configured (ShopID/Secret missing). Running in UI overlay simulator mode for order ${orderId}`);
    return res.json({
      success: true,
      realPayment: false,
      confirmationUrl: null,
      message: 'Запущен встроенный интерактивный симулятор платежного шлюза ЮKassa.'
    });
  }
});

// 9.7. API: VEBHUK YOOKASSA (Real webhook for async payments notification)
app.post('/api/payments/yookassa-webhook', async (req, res) => {
  const eventData = req.body;
  if (eventData && eventData.event === 'payment.succeeded') {
    const payment = eventData.object;
    const orderId = payment.metadata?.orderId;
    if (orderId) {
      console.log(`[YooKassa Webhook] Success notification received for Order: ${orderId}`);
      await markOrderAsPaid(orderId, 'paid', '💳 Онлайн-платёж успешно проведён и подтверждён через вебхук ЮKassa ✨');
    }
  }
  res.status(200).send('OK');
});

// 9.8. API: CHECK PAYMENT STATUS WITH YOOKASSA
app.get('/api/yookassa/check-payment/:orderId', async (req, res) => {
  const { orderId } = req.params;
  
  let order: any = null;
  try {
    const docSnap = await getDoc(doc(db, 'orders', orderId));
    if (docSnap.exists()) {
      order = docSnap.data();
    }
  } catch (err) {
    // ignore
  }

  if (!order) {
    order = mockOrdersList.find(o => o.orderId === orderId);
  }

  if (!order) {
    return res.status(404).json({ error: 'Заказ не найден.' });
  }

  if (isYooKassaConfigured() && order.yookassaPaymentId) {
    try {
      const auth = Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString('base64');
      const response = await fetch(`https://api.yookassa.ru/v3/payments/${order.yookassaPaymentId}`, {
        headers: { 'Authorization': `Basic ${auth}` }
      });

      if (response.ok) {
        const paymentData = (await response.json()) as any;
        if (paymentData.status === 'succeeded') {
          await markOrderAsPaid(orderId, 'paid', '💳 Онлайн-платёж успешно подтверждён через запрос к API ЮKassa ✨');
          
          let updatedOrder = order;
          try {
            const snap = await getDoc(doc(db, 'orders', orderId));
            if (snap.exists()) updatedOrder = snap.data();
          } catch {}
          return res.json({ success: true, status: 'succeeded', order: updatedOrder });
        }
        return res.json({ success: false, status: paymentData.status, order });
      }
    } catch (e: any) {
      console.error('Error checking payment status from YooKassa:', e);
    }
  }

  return res.json({ success: false, status: order.paymentStatus || 'unpaid', order });
});

// 10. API: GET FEEDBACK REVIEWS
app.get('/api/reviews', async (req, res) => {
  const pathForGet = 'reviews';
  try {
    const snap = await getDocs(collection(db, pathForGet));
    let list = snap.docs.map(doc => doc.data());
    if (list.length === 0) {
      list = [...reviewsList];
    } else {
      list.sort((a: any, b: any) => b.id.localeCompare(a.id));
    }
    res.json(list);
  } catch (error) {
    console.warn('Firestore fetch reviews failed, returning local reviewsList fallback:', error);
    res.json(reviewsList);
  }
});

// 11. API: WRITE A CUSTOM REVIEWS ENTRY
app.post('/api/reviews', async (req, res) => {
  const { author, rating, comment } = req.body;
  if (!author || !rating || !comment) {
    return res.status(400).json({ error: 'Пожалуйста, заполните все обязательные поля.' });
  }

  const id = `review-${Date.now()}`;
  const newReview = {
    id,
    author,
    rating: Number(rating),
    comment,
    date: new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  };

  const pathForWrite = 'reviews';
  try {
    await setDoc(doc(db, pathForWrite, id), newReview);
  } catch (error) {
    console.warn('Firestore review creation failed, saving to local in-memory reviewsList:', error);
  }

  // Ensure instant synchronization in-memory
  const exists = reviewsList.some(r => r.id === id);
  if (!exists) {
    reviewsList.unshift(newReview);
  }

  res.json({ success: true, review: newReview });
});

// Bootstrapped Connection and Seeding Routines on initialization
async function verifyConnectionAndSeed() {
  console.log('Validating connection to Firestore server...');
  try {
    await getDocFromServer(doc(db, 'test', 'connection')).catch(() => {
      // Offline connection is fine, this fires request if possible
    });
  } catch (error) {
    console.warn('Initial Firestore validation bypass/local cache warning.');
  }

  console.log('Seeding database entities if empty...');
  try {
    // 1. Seed Products
    const productsSnapshot = await getDocs(collection(db, 'products'));
    if (productsSnapshot.empty) {
      console.log('Seeding products to Firestore...');
      let orderIdx = 0;
      for (const prod of productsList) {
        await setDoc(doc(db, 'products', prod.id), { ...prod, order: orderIdx++ });
      }
      console.log('Products seeded successfully.');
    }

    // 2. Seed Reviews
    const reviewsSnapshot = await getDocs(collection(db, 'reviews'));
    if (reviewsSnapshot.empty) {
      console.log('Seeding reviews to Firestore...');
      for (const rev of reviewsList) {
        await setDoc(doc(db, 'reviews', rev.id), rev);
      }
      console.log('Reviews seeded successfully.');
    }

    // 3. Seed Orders
    const ordersSnapshot = await getDocs(collection(db, 'orders'));
    if (ordersSnapshot.empty) {
      console.log('Seeding orders to Firestore...');
      for (const ord of mockOrdersList) {
        await setDoc(doc(db, 'orders', ord.orderId), ord);
      }
      console.log('Orders seeded successfully.');
    }
  } catch (error) {
    console.error('Failed to auto-seed Firestore database collections:', error);
  }
}

// 12. Vite development server setup / production static serving
async function startServer() {
  // Start seeding and verification in background without blocking server listen
  verifyConnectionAndSeed().catch(err => {
    console.error('Non-blocking Firestore setup encountered an error:', err);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Express custom server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
