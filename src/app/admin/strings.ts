import type { OrderStatus, PaymentMethod, PaymentStatus } from '@/lib/domain';

/**
 * Every word the staff panel says, in one object.
 *
 * Russian only, for now, and that is a scoping decision rather than an
 * oversight. The storefront is trilingual because its readers are; this panel
 * has a handful of users who share a language, and translating it three ways
 * would triple the copy for an audience of two while the product is still
 * moving weekly.
 *
 * The seam is here so that changing that later is mechanical rather than a
 * rewrite: nothing in `app/admin` or `components/admin` contains a literal
 * string, so `ADMIN_TEXT` becomes a lookup keyed by locale and every call site
 * already reads from it. `next-intl` is already configured for the storefront
 * and would host these as a fourth namespace.
 */
export const ADMIN_TEXT = {
  brand: 'Mavena Kitchen',
  panel: 'Панель ресторана',

  nav: {
    dashboard: 'Сводка',
    orders: 'Заказы',
    menu: 'Меню',
    settings: 'Настройки',
    staff: 'Сотрудники',
    signOut: 'Выйти',
    openSite: 'Открыть сайт',
  },

  login: {
    title: 'Вход в панель',
    email: 'Email',
    password: 'Пароль',
    submit: 'Войти',
    submitting: 'Проверяем…',
    failed: 'Неверный email или пароль',
    missingFields: 'Заполните оба поля',
    rateLimited: 'Слишком много попыток входа.',
    retryIn: 'Попробуйте через {minutes} мин.',
  },

  unconfigured: {
    title: 'Панель не настроена',
    body: 'Для панели ресторана не задан AUTH_SECRET, поэтому вход невозможен. Пока переменная не появится в окружении, панель не открывается — это защита, а не ошибка.',
    hint: 'Задайте AUTH_SECRET в переменных окружения и создайте учётную запись сотрудника.',
  },

  pause: {
    title: 'Приём заказов',
    accepting: 'Заказы принимаются',
    paused: 'Приём заказов остановлен',
    acceptingHint:
      'Сайт принимает заказы в рабочие часы. Остановите приём, если кухня перегружена или что-то случилось — клиенты увидят сообщение на своём языке.',
    pausedHint:
      'Новые заказы сейчас не оформляются. Уже принятые заказы, панель, Telegram и страницы отслеживания работают как обычно.',
    pause: 'Остановить приём',
    resume: 'Возобновить приём',
    confirm:
      'Клиенты не смогут оформить новый заказ, пока вы не включите приём обратно. Уже принятые заказы это не затронет.',
    confirmPause: 'Да, остановить',
    cancel: 'Отмена',
    saving: 'Сохраняем…',
    failed: 'Не удалось изменить. Обновите страницу и попробуйте снова.',
    demoBlocked: 'В демо-режиме приём заказов не переключается',
  },

  forbidden: {
    title: 'Раздел только для владельца',
    body: 'У вашей учётной записи нет доступа к этому разделу. Цены, настройки Telegram и сотрудники доступны только владельцу.',
    back: 'К заказам',
  },

  staff: {
    title: 'Сотрудники',
    subtitle: 'Кто может входить в панель и что может менять',
    nav: 'Сотрудники',
    name: 'Имя',
    email: 'Email',
    role: 'Роль',
    roleOwner: 'Владелец',
    roleManager: 'Менеджер',
    status: 'Доступ',
    active: 'Активен',
    inactive: 'Отключён',
    lastLogin: 'Последний вход',
    never: 'ни разу',
    add: 'Добавить сотрудника',
    adding: 'Добавляем…',
    added: 'Сотрудник добавлен',
    password: 'Пароль',
    passwordHint:
      'Минимум 12 символов. Продиктуйте его сотруднику лично — восстановления по email здесь нет.',
    disable: 'Отключить',
    enable: 'Включить',
    makeOwner: 'Сделать владельцем',
    makeManager: 'Сделать менеджером',
    resetPassword: 'Сменить пароль',
    saving: 'Сохраняем…',
    saved: 'Сохранено',
    confirmDisable: 'Отключить доступ этому сотруднику?',
    /** Every one of these ends the person's sessions — worth saying, not hiding. */
    sessionsNote:
      'Смена роли, пароля или отключение доступа немедленно завершают все сеансы этого сотрудника.',
    myPassword: 'Мой пароль',
    currentPassword: 'Текущий пароль',
    newPassword: 'Новый пароль',
    changePassword: 'Сменить пароль',
    passwordChanged: 'Пароль изменён. Остальные устройства разлогинены.',
    signOutEverywhere: 'Выйти на всех устройствах',
    signedOutEverywhere: 'Остальные устройства разлогинены',
    errors: {
      EMAIL_TAKEN: 'Такой email уже используется',
      NOT_FOUND: 'Сотрудник не найден',
      WEAK_PASSWORD: 'Пароль слишком короткий — минимум 12 символов',
      LAST_OWNER: 'Это последний активный владелец — нельзя оставить панель без доступа',
      WRONG_PASSWORD: 'Текущий пароль неверен',
      INVALID: 'Проверьте поля формы',
      FORBIDDEN: 'Нет прав на это действие',
      DEMO_MODE: 'В демо-режиме сотрудники не редактируются',
    } as Record<string, string>,
  },

  demo: {
    banner: 'Демонстрационный режим',
    explain:
      'Это демонстрация панели на вымышленных заказах. Изменения статусов живут только в этой вкладке и не сохраняются: обновите страницу или закройте вкладку — и всё вернётся к исходному состоянию. Ничего не записывается в базу.',
    reset: 'Сбросить демо-данные',
    resetDone: 'Демо-данные возвращены к исходным',
    trackingHint: 'Открыть страницу клиента',
  },

  dashboard: {
    title: 'Сегодня',
    subtitle: 'Только заказы, оформленные через сайт',
    disclaimer:
      'Продажи в зале и по телефону система не видит — это не общая выручка ресторана, а только заказы с сайта.',
    ordersToday: 'Заказов через сайт',
    siteTotalToday: 'Сумма заказов с сайта',
    averageOrder: 'Средний чек с сайта',
    awaitingAction: 'Требуют внимания',
    byStatus: 'По статусам',
    emptyDay: 'Сегодня заказов с сайта ещё не было',
    goToOrders: 'Все заказы',
  },

  orders: {
    title: 'Заказы',
    searchLabel: 'Поиск по номеру заказа или телефону',
    searchPlaceholder: 'MK-482193 или 093 12 34 56',
    searchApply: 'Найти',
    searchClear: 'Сбросить',
    filterAll: 'Все',
    empty: 'Заказов нет',
    emptyFiltered: 'По этому фильтру ничего не найдено',
    isNew: 'новый',
    itemCount: 'позиций',
    openOrder: 'Открыть заказ',
    page: 'Страница',
    of: 'из',
    prev: 'Назад',
    next: 'Вперёд',
  },

  order: {
    back: 'К списку заказов',
    notFound: 'Заказ не найден',
    placed: 'Оформлен',
    eta: 'Готовность',
    minutes: 'мин',
    customer: 'Клиент',
    phone: 'Телефон',
    call: 'Позвонить',
    delivery: 'Доставка',
    pickup: 'Самовывоз',
    address: 'Адрес',
    landmark: 'Ориентир',
    coordinates: 'Координаты',
    openMap: 'Открыть на карте',
    payment: 'Оплата',
    notes: 'Комментарий клиента',
    noNotes: 'Без комментария',
    items: 'Состав',
    subtotal: 'Сумма заказа',
    deliveryFee: 'Доставка',
    total: 'Итого',
    history: 'История статусов',
    changeStatus: 'Изменить статус',
    noTransitions: 'Заказ завершён — статус больше не меняется',
    cancelReason: 'Причина отмены',
    cancelPrompt: 'Причина отмены (необязательно)',
    confirmCancel: 'Отменить заказ',
    changing: 'Сохраняем…',
    changeFailed: 'Не удалось изменить статус. Обновите страницу и попробуйте снова.',
    illegalTransition: 'Статус уже изменился. Обновите страницу.',
    source: { ADMIN: 'панель', CUSTOMER: 'клиент', TELEGRAM: 'Telegram' } as Record<string, string>,
  },

  notify: {
    title: 'Уведомление в Telegram',
    SENT: 'Доставлено',
    PENDING: 'В очереди',
    FAILED: 'Не доставлено',
    chats: 'Чатов получило',
    attempts: 'Попыток',
    resend: 'Отправить снова',
    resending: 'Отправляем…',
    resent: 'Отправлено',
    resendFailed: 'Не удалось отправить — подробности в статусе выше',
    notConfigured: 'Telegram не настроен: нет токена бота',
    none: 'Уведомление не ставилось в очередь',
  },

  settings: {
    title: 'Настройки',
    subtitle: 'Приём заказов и уведомления кухне',
    telegramTitle: 'Telegram',
    chatIdsLabel: 'ID чатов',
    chatIdsHint:
      'По одному в строке. Добавьте бота в группу кухни и возьмите ID оттуда — у групп он отрицательный.',
    save: 'Сохранить',
    saved: 'Сохранено',
    invalid: 'Не похоже на ID чата:',
    test: 'Отправить тестовое сообщение',
    testing: 'Отправляем…',
    noToken: 'Не задан TELEGRAM_BOT_TOKEN — бот выключен',
    noWebhookSecret:
      'Не задан TELEGRAM_WEBHOOK_SECRET — кнопки статусов из Telegram работать не будут',
    ready: 'Бот подключён',
    demoBlocked: 'В демо-режиме Telegram отключён и настройки не сохраняются',
    empty: 'Ни один чат не подключён — уведомления никуда не уйдут',
  },

  menu: {
    title: 'Меню',
    subtitle: 'Цена и наличие. Остальное редактируется в коде, пока не появится полный редактор.',
    dish: 'Блюдо',
    category: 'Категория',
    price: 'Цена',
    fromPrice: 'от',
    hasOptions: 'есть опции',
    available: 'В наличии',
    unavailable: 'Нет в наличии',
    inactive: 'Снято с меню',
    save: 'Сохранить',
    saved: 'Сохранено',
    saveFailed: 'Не удалось сохранить',
    invalidPrice: 'Некорректная цена',
    priceHint: 'Целое число драмов. Цены в уже оформленных заказах не меняются.',
    demoBlocked: 'В демо-режиме меню не редактируется',
  },

  status: {
    AWAITING_PAYMENT: 'Ожидает оплаты',
    NEW: 'Новый',
    CONFIRMED: 'Подтверждён',
    PREPARING: 'Готовится',
    READY: 'Готов',
    DELIVERING: 'В пути',
    COMPLETED: 'Выдан',
    CANCELLED: 'Отменён',
  } satisfies Record<OrderStatus, string>,

  payment: {
    CASH: 'Наличными',
    CARD_ON_DELIVERY: 'Картой курьеру',
    ONLINE: 'Онлайн',
  } satisfies Record<PaymentMethod, string>,

  /** The state of the money, as distinct from the state of the order. */
  paymentStatus: {
    PENDING: 'Не оплачен',
    PAID: 'Оплачен',
    FAILED: 'Оплата не прошла',
    EXPIRED: 'Время оплаты истекло',
    REFUNDED: 'Возвращён',
  } satisfies Record<PaymentStatus, string>,

  payments: {
    title: 'Онлайн-оплата',
    none: 'Попыток оплаты не было',
    attempt: 'Попытка',
    amount: 'Сумма',
    provider: 'Провайдер',
    reference: 'Ссылка провайдера',
    at: 'Подтверждена',
    reason: 'Причина',
    /**
     * The one line in this panel that asks for money to be moved by hand.
     * Deliberately blunt: it means the restaurant is holding drams it is not
     * entitled to, and nothing in the software will resolve that on its own.
     */
    needsRefund: 'Требуется возврат — деньги получены, но заказ не выполняется',
    check: 'Проверить оплату',
    checking: 'Проверяем…',
    checkFailed: 'Не удалось проверить оплату',
    awaiting: 'Заказ ждёт оплаты и не готовится',
    expiresAt: 'Оплатить до',
  },
} as const;
