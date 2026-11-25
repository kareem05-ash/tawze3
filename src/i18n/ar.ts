/** ALL user-facing strings live here so wording can be corrected in one place. */
export const ar = {
  appName: 'موزّع برو',
  nav: { home: 'الرئيسية', sales: 'المبيعات', purchases: 'المشتريات', parties: 'الحسابات', more: 'المزيد' },
  pages: {
    home: 'نظرة عامة', sales: 'فواتير البيع', purchases: 'فواتير الشراء', parties: 'العملاء والموردون', more: 'المزيد',
  },
  more: { products: 'الأصناف والمخزون', reports: 'التقارير', backup: 'النسخ الاحتياطي', settings: 'الإعدادات' },
  theme: { light: 'الوضع الفاتح', dark: 'الوضع الداكن', toggle: 'تبديل المظهر' },
  empty: { title: 'لا توجد بيانات بعد', soon: 'هذه الشاشة قيد الإنشاء في المرحلة التالية.' },
  db: { loading: 'جارٍ تجهيز قاعدة البيانات…', ready: 'قاعدة البيانات جاهزة', version: 'إصدار المخطط', failed: 'تعذّر فتح قاعدة البيانات', retry: 'إعادة المحاولة' },
} as const;
