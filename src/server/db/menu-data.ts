import type { ProductBadge } from '@/lib/domain';
import type { LocalizedText } from '@/lib/i18n/locales';

/**
 * The fictional Mavena Kitchen portfolio menu.
 *
 * The multilingual names, descriptions, categories and options form a coherent
 * demo catalogue for exercising the storefront and admin workflows.
 *
 * Two modelling choices are deliberate:
 *
 * 1. **Categories.** The catalogue is grouped by how a customer browses rather
 *    than rendered as one long flat list.
 *
 * 2. **Sizes become options, not separate dishes.** Variants are modelled as a
 *    single-choice option group with a price delta, so one card exposes every
 *    concrete price.
 *
 * Every price here is an invented demo value and stays editable in the admin
 * panel; nothing in this file is anybody's real price list.
 */

export interface SeedOption {
  name: LocalizedText;
  priceDelta: number;
  isDefault?: boolean;
}

export interface SeedOptionGroup {
  name: LocalizedText;
  type: 'SINGLE' | 'MULTI';
  minSelect: number;
  maxSelect: number;
  options: SeedOption[];
}

export interface SeedProduct {
  slug: string;
  name: LocalizedText;
  description?: LocalizedText;
  basePrice: number;
  badges?: ProductBadge[];
  weightGrams?: number;
  optionGroups?: SeedOptionGroup[];
}

export interface SeedCategory {
  slug: string;
  name: LocalizedText;
  products: SeedProduct[];
}

function t(hy: string, ru: string, en: string): LocalizedText {
  return { hy, ru, en };
}

/** Original or spicy, at no extra cost. Shared by strips, wings and drumsticks. */
const spiceGroup: SeedOptionGroup = {
  name: t('Համ', 'Вкус', 'Flavour'),
  type: 'SINGLE',
  minSelect: 1,
  maxSelect: 1,
  options: [
    { name: t('Օրիգինալ', 'Оригинальный', 'Original'), priceDelta: 0, isDefault: true },
    { name: t('Կծու', 'Острый', 'Spicy'), priceDelta: 0 },
  ],
};

/**
 * Add-ons, for demonstrating multi-select configuration. Both the list and the
 * prices are editable in the admin panel.
 */
const burgerExtras: SeedOptionGroup = {
  name: t('Հավելումներ', 'Добавки', 'Extras'),
  type: 'MULTI',
  minSelect: 0,
  maxSelect: 4,
  options: [
    { name: t('Չեդդար', 'Чеддер', 'Cheddar'), priceDelta: 200 },
    { name: t('Կրկնակի կոտլետ', 'Двойная котлета', 'Double patty'), priceDelta: 500 },
    { name: t('Թթու վարունգ', 'Маринованный огурец', 'Pickles'), priceDelta: 100 },
    { name: t('Կծու սոուս', 'Острый соус', 'Hot sauce'), priceDelta: 100 },
  ],
};

export const MENU: SeedCategory[] = [
  // ---------------------------------------------------------------- Burgers
  {
    slug: 'burgers',
    name: t('Բուրգերներ', 'Бургеры', 'Burgers'),
    products: [
      {
        slug: 'burger-beef',
        name: t('Բուրգեր տավարի', 'Бургер с говядиной', 'Beef Burger'),
        description: t(
          'Տավարի կոտլետ, սոխ, լոլիկ, թթու վարունգ, հազար, սոուսներ',
          'Говяжья котлета, лук, помидор, маринованный огурец, салат, соусы',
          'Beef cutlet, onions, tomatoes, pickles, lettuce, sauces',
        ),
        basePrice: 1350,
        badges: ['HIT'],
        optionGroups: [burgerExtras],
      },
      {
        slug: 'cheeseburger-beef',
        name: t('Չիզբուրգեր տավարի մսով', 'Чизбургер с говядиной', 'Beef Cheeseburger'),
        description: t(
          'Կոտլետ տավարի և խոզի մսից, լոլիկ, մարինացված վարունգ, կարմիր սոխ, հազար, հալվող պանիր, կարմիր և սպիտակ սոուսներ',
          'Котлета из говядины и свинины, помидор, маринованный огурец, красный лук, салат, плавленый сыр, красный и белый соусы',
          'Beef and pork cutlet, tomato, pickles, red onion, lettuce, melted cheese, red and white sauces',
        ),
        basePrice: 1400,
        optionGroups: [burgerExtras],
      },
      {
        slug: 'double-cheeseburger',
        name: t('Դաբլ չիզբուրգեր', 'Двойной чизбургер', 'Double Cheeseburger'),
        description: t(
          '2 կոտլետ, չեդդար, հազար, լոլիկ, սոխ, թթու վարունգ, սոուսներ',
          'Две котлеты, чеддер, салат, помидор, лук, маринованный огурец, соусы',
          'Two cutlets, cheddar, lettuce, tomato, onion, pickles, sauces',
        ),
        basePrice: 2200,
        badges: ['HIT'],
        optionGroups: [burgerExtras],
      },
      {
        slug: 'angus-burger',
        name: t('Բուրգեր անգուսի մսով', 'Бургер из говядины ангус', 'Angus Burger'),
        description: t(
          'Անգուսի կոտլետ, չեդդար, հազար, լոլիկ, թթու վարունգ, սոխ, բուրգերի սոուս',
          'Котлета из мраморной говядины ангус, чеддер, салат, помидор, маринованный огурец, лук, фирменный соус',
          'Angus cutlet, cheddar, lettuce, tomato, pickles, onion, burger sauce',
        ),
        basePrice: 2550,
        badges: ['NEW'],
        optionGroups: [burgerExtras],
      },
      {
        slug: 'chicken-burger',
        name: t('Չիքեն բուրգեր', 'Чикен бургер', 'Chicken Burger'),
        description: t(
          'Հավի 2 ստրիպս, լոլիկ, հազար, թթու վարունգ, սոուսներ',
          'Два куриных стрипса, помидор, салат, маринованный огурец, соусы',
          'Two chicken strips, tomato, lettuce, pickles, sauces',
        ),
        basePrice: 1200,
        badges: ['HIT'],
        optionGroups: [burgerExtras],
      },
      {
        slug: 'chicken-burger-classic',
        name: t('Չիքեն բուրգեր Դասական', 'Чикен бургер Классический', 'Chicken Burger Classic'),
        description: t(
          'Կոտլետ հավի աղացած մսով, լոլիկ, մարինացված վարունգ, հազար, կարմիր և սպիտակ սոուսներ',
          'Котлета из куриного фарша, помидор, маринованный огурец, салат, красный и белый соусы',
          'Minced chicken cutlet, tomato, pickles, lettuce, red and white sauces',
        ),
        basePrice: 1100,
      },
      {
        slug: 'chicken-cheeseburger',
        name: t('Չիքեն Չիզ բուրգեր', 'Чикен чизбургер', 'Chicken Cheeseburger'),
        description: t(
          'Հավի 3 ստրիպս, հազար, լոլիկ, թթու վարունգ, չեդդար, սոուսներ',
          'Три куриных стрипса, салат, помидор, маринованный огурец, чеддер, соусы',
          'Three chicken strips, lettuce, tomato, pickles, cheddar, sauces',
        ),
        basePrice: 1650,
        optionGroups: [burgerExtras],
      },
      {
        slug: 'chicken-cheeseburger-double',
        name: t('Չիքեն չիզբուրգեր Double', 'Чикен чизбургер Double', 'Chicken Cheeseburger Double'),
        description: t(
          '2 կոտլետ հավի աղացած մսով, հալվող պանիր, լոլիկ, մարինացված վարունգ, հազար, սոուսներ',
          'Две котлеты из куриного фарша, плавленый сыр, помидор, маринованный огурец, салат, соусы',
          'Two minced chicken cutlets, melted cheese, tomato, pickles, lettuce, sauces',
        ),
        basePrice: 1500,
      },
      {
        slug: 'chicken-burger-deluxe',
        name: t('Չիքեն բուրգեր դելյուքս', 'Чикен бургер Делюкс', 'Chicken Burger Deluxe'),
        description: t(
          'Հաց, թարմ վարունգ, հավի ստրիպս, լոլիկ, կարտոֆիլ, բիբար, սոուսներ',
          'Булочка, свежий огурец, куриные стрипсы, помидор, картофель, перец, соусы',
          'Bun, fresh cucumber, chicken strips, tomato, potato, pepper, sauces',
        ),
        basePrice: 1800,
        badges: ['NEW'],
      },
    ],
  },

  // --------------------------------------------------------------- Hot dogs
  {
    slug: 'hot-dogs',
    name: t('Հոթ-դոգ', 'Хот-доги', 'Hot dogs'),
    products: [
      {
        slug: 'hot-dog-lite',
        name: t('Հոթ-դոգ լայթ', 'Хот-дог лайт', 'Hot dog lite'),
        description: t('Նրբերշիկ, սոուսներ', 'Сосиска, соусы', 'Sausage, sauces'),
        basePrice: 450,
      },
      {
        slug: 'hot-dog',
        name: t('Հոթ-դոգ', 'Хот-дог', 'Hot dog'),
        description: t(
          'Նրբերշիկ Մարիլա, հազար, լոլիկ, թթու վարունգ, սոուսներ',
          'Сосиска Марилла, салат, помидор, маринованный огурец, соусы',
          'Marilla sausage, lettuce, tomato, pickles, sauces',
        ),
        basePrice: 650,
      },
      {
        slug: 'longer',
        name: t('Լոնգեր', 'Лонгер', 'Longer'),
        description: t(
          'Հավի ստրիպս, լոլիկ, թթու վարունգ, հազար, սոուսներ',
          'Куриные стрипсы, помидор, маринованный огурец, салат, соусы',
          'Chicken strips, tomato, pickles, lettuce, sauces',
        ),
        basePrice: 700,
      },
    ],
  },

  // ------------------------------------------------------------------ Rolls
  {
    slug: 'rolls',
    name: t('Ռոլլ', 'Роллы', 'Rolls'),
    products: [
      {
        slug: 'chicken-roll',
        name: t('Չիքեն ռոլլ', 'Чикен ролл', 'Chicken roll'),
        description: t(
          'Թարմ լավաշ, հավի ստրիպս, լոլիկ, վարունգ, աղցան, հազար, սոուսներ',
          'Свежий лаваш, куриные стрипсы, помидор, огурец, салат, соусы',
          'Fresh lavash, chicken strips, tomato, cucumber, salad, sauces',
        ),
        basePrice: 1500,
      },
      {
        slug: 'chicken-roll-duo',
        name: t('Չիքեն ռոլ դուո', 'Чикен ролл дуо', 'Chicken roll duo'),
        description: t(
          '2 հատ չիքեն ռոլ + 2 հատ թան 0.33լ Մարիլա',
          'Два чикен ролла + два тана 0,33 л Марилла',
          'Two chicken rolls + two 0.33 l Marilla tan',
        ),
        basePrice: 3400,
      },
    ],
  },

  // ---------------------------------------------------------------- Chicken
  {
    slug: 'chicken',
    name: t('Հավ', 'Курица', 'Chicken'),
    products: [
      {
        slug: 'chicken-strips',
        name: t('Ստրիպս', 'Стрипсы', 'Chicken strips'),
        description: t('Հավի կրծքամիս', 'Куриная грудка', 'Chicken breast'),
        basePrice: 750,
        badges: ['HIT'],
        optionGroups: [
          {
            name: t('Քանակ', 'Количество', 'Portion'),
            type: 'SINGLE',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: t('3 հատ', '3 шт', '3 pcs'), priceDelta: 0, isDefault: true },
              { name: t('6 հատ', '6 шт', '6 pcs'), priceDelta: 750 },
            ],
          },
          spiceGroup,
        ],
      },
      {
        slug: 'chicken-wings',
        name: t('Թևիկ', 'Крылышки', 'Chicken wings'),
        description: t('Հավի թևիկներ', 'Куриные крылышки', 'Chicken wings'),
        basePrice: 900,
        optionGroups: [
          {
            name: t('Քանակ', 'Количество', 'Portion'),
            type: 'SINGLE',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: t('4 հատ', '4 шт', '4 pcs'), priceDelta: 0, isDefault: true },
              { name: t('8 հատ', '8 шт', '8 pcs'), priceDelta: 700 },
              { name: t('12 հատ', '12 шт', '12 pcs'), priceDelta: 1300 },
            ],
          },
          spiceGroup,
        ],
      },
      {
        slug: 'chicken-drumsticks',
        name: t('Բդիկ', 'Голени', 'Drumsticks'),
        description: t('Հավի բդիկներ', 'Куриные голени', 'Chicken drumsticks'),
        basePrice: 600,
        optionGroups: [
          {
            name: t('Քանակ', 'Количество', 'Portion'),
            type: 'SINGLE',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: t('2 հատ', '2 шт', '2 pcs'), priceDelta: 0, isDefault: true },
              { name: t('3 հատ', '3 шт', '3 pcs'), priceDelta: 400 },
              { name: t('5 հատ', '5 шт', '5 pcs'), priceDelta: 900 },
            ],
          },
          spiceGroup,
        ],
      },
      {
        slug: 'nuggets',
        name: t('Նագետ', 'Наггетсы', 'Chicken nuggets'),
        description: t(
          'Հավի խրթխրթան նագետներ',
          'Хрустящие куриные наггетсы',
          'Crispy chicken nuggets',
        ),
        basePrice: 500,
        optionGroups: [
          {
            name: t('Քանակ', 'Количество', 'Portion'),
            type: 'SINGLE',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: t('3 հատ', '3 шт', '3 pcs'), priceDelta: 0, isDefault: true },
              { name: t('6 հատ', '6 шт', '6 pcs'), priceDelta: 400 },
            ],
          },
        ],
      },
    ],
  },

  // ----------------------------------------------------------------- Potato
  {
    slug: 'potato',
    name: t('Կարտոֆիլ', 'Картофель', 'Potato'),
    products: [
      {
        slug: 'fries',
        name: t('Ֆրի', 'Картофель фри', 'French fries'),
        description: t('Խրթխրթան կարտոֆիլ ֆրի', 'Хрустящий картофель фри', 'Crispy french fries'),
        basePrice: 500,
        badges: ['HIT'],
        optionGroups: [
          {
            name: t('Չափս', 'Размер', 'Size'),
            type: 'SINGLE',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: t('80 գ', '80 г', '80 g'), priceDelta: 0, isDefault: true },
              { name: t('120 գ', '120 г', '120 g'), priceDelta: 200 },
              { name: t('240 գ', '240 г', '240 g'), priceDelta: 600 },
            ],
          },
        ],
      },
      {
        slug: 'potato-wedges',
        name: t('Գյուղական կարտոֆիլ', 'Картофель по-деревенски', 'Potato wedges'),
        basePrice: 800,
        optionGroups: [
          {
            name: t('Չափս', 'Размер', 'Size'),
            type: 'SINGLE',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: t('200 գ', '200 г', '200 g'), priceDelta: 0, isDefault: true },
              { name: t('400 գ', '400 г', '400 g'), priceDelta: 750 },
            ],
          },
        ],
      },
    ],
  },

  // ------------------------------------------------------------------ Combo
  {
    slug: 'combo',
    name: t('Բասքեթ և Կոմբո', 'Комбо и баскеты', 'Combo & baskets'),
    products: [
      {
        slug: 'mavena-box',
        name: t('Mavena Box', 'Mavena Box', 'Mavena Box'),
        description: t(
          'Հարմարավետ box ընդմիջման համար',
          'Удобный бокс для перерыва',
          'A convenient box for a break',
        ),
        basePrice: 2700,
        badges: ['NEW'],
        optionGroups: [
          {
            name: t('Համադրություն', 'Состав', 'Combination'),
            type: 'SINGLE',
            minSelect: 1,
            maxSelect: 1,
            options: [
              {
                name: t(
                  'Բուրգեր, 2 ստրիպս, ֆրի մինի, կարմիր սոուս, հյութ 0.2լ',
                  'Бургер, 2 стрипса, мини фри, красный соус, сок 0,2 л',
                  'Burger, 2 strips, mini fries, red sauce, 0.2 l juice',
                ),
                priceDelta: 0,
                isDefault: true,
              },
              {
                name: t(
                  'Չիքեն բուրգեր, 3 թևիկ, ֆրի մինի, կարմիր սոուս, հյութ 0.2լ',
                  'Чикен бургер, 3 крылышка, мини фри, красный соус, сок 0,2 л',
                  'Chicken burger, 3 wings, mini fries, red sauce, 0.2 l juice',
                ),
                priceDelta: 0,
              },
            ],
          },
        ],
      },
      {
        slug: 'beef-burger-combo',
        name: t('Բուրգեր տավարի կոմբո', 'Комбо с бургером', 'Beef Burger Combo'),
        description: t(
          'Բուրգեր տավարի + գազավորված ըմպելիք 0.25լ',
          'Бургер с говядиной + газированный напиток 0,25 л',
          'Beef burger + a soft drink 0.25 l',
        ),
        basePrice: 1700,
        badges: ['HIT'],
        optionGroups: [
          {
            name: t('Ըմպելիք', 'Напиток', 'Drink'),
            type: 'SINGLE',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: t('Կոլա', 'Кола', 'Cola'), priceDelta: 0, isDefault: true },
              { name: t('Նարնջի', 'Апельсиновый', 'Orange'), priceDelta: 0 },
              { name: t('Լիմոն-լայմ', 'Лимон-лайм', 'Lemon-lime'), priceDelta: 0 },
            ],
          },
          {
            name: t('Հավելում', 'Дополнение', 'Add-on'),
            type: 'MULTI',
            minSelect: 0,
            maxSelect: 1,
            options: [
              { name: t('Ֆրի մինի 90 գ', 'Мини фри 90 г', 'Mini fries 90 g'), priceDelta: 450 },
            ],
          },
        ],
      },
      {
        slug: 'mini-basket',
        name: t('Բասքեթ մինի', 'Баскет мини', 'Mini basket'),
        description: t(
          'Մինի բասքեթներ տարբեր համադրություններով',
          'Мини баскеты в разных сочетаниях',
          'Mini baskets in different combinations',
        ),
        basePrice: 1150,
        optionGroups: [
          {
            name: t('Համադրություն', 'Состав', 'Combination'),
            type: 'SINGLE',
            minSelect: 1,
            maxSelect: 1,
            options: [
              {
                name: t('Համադրություն 1', 'Состав 1', 'Combination 1'),
                priceDelta: 0,
                isDefault: true,
              },
              { name: t('Համադրություն 2', 'Состав 2', 'Combination 2'), priceDelta: 600 },
            ],
          },
        ],
      },
      {
        slug: 'basket-combo',
        name: t('Բասքեթ կոմբո', 'Баскет комбо', 'Basket combo'),
        description: t(
          'Բասքեթներ տարբեր համադրություններով, ընկերության համար',
          'Баскеты в разных сочетаниях, на компанию',
          'Baskets in different combinations, for sharing',
        ),
        basePrice: 4300,
        optionGroups: [
          {
            name: t('Համադրություն', 'Состав', 'Combination'),
            type: 'SINGLE',
            minSelect: 1,
            maxSelect: 1,
            options: [
              {
                name: t('Համադրություն 1', 'Состав 1', 'Combination 1'),
                priceDelta: 0,
                isDefault: true,
              },
              { name: t('Համադրություն 2', 'Состав 2', 'Combination 2'), priceDelta: 1200 },
            ],
          },
        ],
      },
    ],
  },

  // ----------------------------------------------------------------- Salads
  {
    slug: 'salads',
    name: t('Աղցաններ', 'Салаты', 'Salads'),
    products: [
      {
        slug: 'salad',
        name: t('Աղցան', 'Салат', 'Salad'),
        description: t('Թարմ բանջարեղենով', 'Из свежих овощей', 'Made with fresh vegetables'),
        basePrice: 600,
        optionGroups: [
          {
            name: t('Չափս', 'Размер', 'Size'),
            type: 'SINGLE',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: t('Փոքր', 'Маленький', 'Small'), priceDelta: 0, isDefault: true },
              { name: t('Մեծ', 'Большой', 'Large'), priceDelta: 950 },
            ],
          },
        ],
      },
    ],
  },

  // ----------------------------------------------------------------- Sauces
  {
    slug: 'sauces',
    name: t('Սոուսներ', 'Соусы', 'Sauces'),
    products: [
      {
        slug: 'sauce',
        name: t('Սոուս', 'Соус', 'Sauce'),
        description: t('Ֆիրմային սոուսներ', 'Фирменные соусы', 'House sauces'),
        basePrice: 200,
        optionGroups: [
          {
            name: t('Տեսակ', 'Вид', 'Type'),
            type: 'SINGLE',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: t('Կետչուպ', 'Кетчуп', 'Ketchup'), priceDelta: 0, isDefault: true },
              { name: t('Բարբեքյու', 'Барбекю', 'BBQ'), priceDelta: 0 },
              { name: t('Չեսնոկ', 'Чесночный', 'Garlic'), priceDelta: 0 },
              { name: t('Պանրի', 'Сырный', 'Cheese'), priceDelta: 0 },
            ],
          },
        ],
      },
    ],
  },

  // ----------------------------------------------------------------- Drinks
  {
    slug: 'drinks',
    name: t('Ըմպելիքներ', 'Напитки', 'Drinks'),
    products: [
      {
        slug: 'soft-drinks',
        name: t('Զովացուցիչ ըմպելիքներ', 'Прохладительные напитки', 'Soft drinks'),
        description: t(
          'Կոլա, նարնջի, լիմոն-լայմ',
          'Кола, апельсиновый, лимон-лайм',
          'Cola, orange, lemon-lime',
        ),
        basePrice: 250,
        optionGroups: [
          {
            name: t('Ծավալ', 'Объём', 'Volume'),
            type: 'SINGLE',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: t('0.25 լ', '0,25 л', '0.25 l'), priceDelta: 0, isDefault: true },
              { name: t('0.5 լ', '0,5 л', '0.5 l'), priceDelta: 150 },
              { name: t('1 լ', '1 л', '1 l'), priceDelta: 400 },
            ],
          },
        ],
      },
      {
        slug: 'coffee-tea',
        name: t('Սուրճ և թեյ', 'Кофе и чай', 'Coffee & tea'),
        basePrice: 200,
        optionGroups: [
          {
            name: t('Ընտրություն', 'Выбор', 'Choice'),
            type: 'SINGLE',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: t('Թեյ', 'Чай', 'Tea'), priceDelta: 0, isDefault: true },
              { name: t('Ամերիկանո', 'Американо', 'Americano'), priceDelta: 150 },
              { name: t('Կապուչինո', 'Капучино', 'Cappuccino'), priceDelta: 300 },
              { name: t('Լատտե', 'Латте', 'Latte'), priceDelta: 500 },
            ],
          },
        ],
      },
    ],
  },

  // --------------------------------------------------------------- Desserts
  {
    slug: 'desserts',
    name: t('Աղանդեր', 'Десерты', 'Desserts'),
    products: [
      {
        slug: 'ice-cream',
        name: t('Պաղպաղակ լցնովի', 'Мороженое', 'Soft-serve ice cream'),
        description: t('Վաֆլե կոնով', 'В вафельном рожке', 'In a waffle cone'),
        basePrice: 500,
      },
    ],
  },
];
