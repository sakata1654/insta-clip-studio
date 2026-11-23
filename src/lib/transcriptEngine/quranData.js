/**
 * Built-in Core Qur'an Corpus & Hilali-Khan Translation Reference
 * Provides verified per-ayah Uthmani Arabic text and Hilali-Khan English translations.
 */

export const QURAN_AYAT_DATABASE = [
  // Al-Fatihah (1:1-7)
  { s: 1, a: 1, ar: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ', en: 'In the Name of Allah, the Most Beneficent, the Most Merciful.' },
  { s: 1, a: 2, ar: 'الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ', en: 'All the praises and thanks be to Allah, the Lord of the Alamin (mankind, jinns and all that exists).' },
  { s: 1, a: 3, ar: 'الرَّحْمَٰنِ الرَّحِيمِ', en: 'The Most Beneficent, the Most Merciful.' },
  { s: 1, a: 4, ar: 'مَالِكِ يَوْمِ الدِّينِ', en: 'The Only Owner (and the Only Ruling Judge) of the Day of Recompense (i.e. the Day of Resurrection).' },
  { s: 1, a: 5, ar: 'إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ', en: 'You (Alone) we worship, and You (Alone) we ask for help (for each and everything).' },
  { s: 1, a: 6, ar: 'اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ', en: 'Guide us to the Straight Way.' },
  { s: 1, a: 7, ar: 'صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ', en: 'The Way of those on whom You have bestowed Your Grace, not (the way) of those who earned Your Anger, nor of those who went astray.' },

  // Al-Baqarah Key Ayat
  { s: 2, a: 21, ar: 'يَا أَيُّهَا النَّاسُ اعْبُدُوا رَبَّكُمُ الَّذِي خَلَقَكُمْ وَالَّذِينَ مِن قَبْلِكُمْ لَعَلَّكُمْ تَتَّقُونَ', en: 'O mankind! Worship your Lord (Allah), Who created you and those who were before you so that you may become Al-Muttaqun (the pious).' },
  { s: 2, a: 153, ar: 'يَا أَيُّهَا الَّذِينَ آمَنُوا اسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ إِنَّ اللَّهَ مَعَ الصَّابِرِينَ', en: 'O you who believe! Seek help in patience and As-Salat (the prayer). Truly! Allah is with As-Sabirin (the patient ones).' },
  { s: 2, a: 155, ar: 'وَلَنَبْلُوَنَّكُم بِشَيْءٍ مِّنَ الْخَوْفِ وَالْجُوعِ وَنَقْصٍ مِّنَ الْأَمْوَالِ وَالْأَنفُسِ وَالثَّمَرَاتِ وَبَشِّرِ الصَّابِرِينَ', en: 'And certainly, We shall test you with something of fear, hunger, loss of wealth, lives and fruits, but give glad tidings to As-Sabirin (the patient ones).' },
  { s: 2, a: 156, ar: 'الَّذِينَ إِذَا أَصَابَتْهُم مُّصِيبَةٌ قَالُوا إِنَّا لِلَّهِ وَإِنَّا إِلَيْهِ رَاجِعُونَ', en: 'Who, when afflicted with calamity, say: "Truly! To Allah we belong and truly, to Him we shall return."' },
  { s: 2, a: 185, ar: 'شَهْرُ رَمَضَانَ الَّذِي أُنزِلَ فِيهِ الْقُرْآنُ هُدًى لِّلنَّاسِ وَبَيِّنَاتٍ مِّنَ الْهُدَىٰ وَالْفُرْقَانِ', en: 'The month of Ramadan in which was revealed the Quran, a guidance for mankind and clear proofs for the guidance and the criterion (between right and wrong).' },
  { s: 2, a: 186, ar: 'وَإِذَا سَأَلَكَ عِبَادِي عَنِّي فَإِنِّي قَرِيبٌ أُجِيبُ دَعْوَةَ الدَّاعِ إِذَا دَعَانِ', en: 'And when My slaves ask you concerning Me, then (answer them), I am indeed near (to them by My Knowledge). I respond to the invocations of the supplicant when he calls on Me.' },
  { s: 2, a: 255, ar: 'اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ لَا تَأْخُذُهُ سِنَةٌ وَلَا نَوْمٌ لَّهُ مَا فِي السَّمَاوَاتِ وَمَا فِي الْأَرْضِ مَن ذَا الَّذِي يَشْفَعُ عِندَهُ إِلَّا بِإِذْنِهِ يَعْلَمُ مَا بَيْنَ أَيْدِيهِمْ وَمَا خَلْفَهُمْ وَلَا يُحِيطُونَ بِشَيْءٍ مِّنْ عِلْمِهِ إِلَّا بِمَا شَاءَ وَسِعَ كُرْسِيُّهُ السَّمَاوَاتِ وَالْأَرْضَ وَلَا يَئُودُهُ حِفْظُهُمَا وَهُوَ الْعَلِيُّ الْعَظِيمُ', en: 'Allah! La ilaha illa Huwa (none has the right to be worshipped but He), the Ever Living, the One Who sustains and protects all that exists. Neither slumber, nor sleep overtakes Him. To Him belongs whatever is in the heavens and whatever is on earth. Who is he that can intercede with Him except with His Permission? He knows what happens to them (His creatures) in this world, and what will happen to them in the Hereafter. And they will never compass anything of His Knowledge except that which He wills. His Kursi extends over the heavens and the earth, and He feels no fatigue in guarding and preserving them. And He is the Most High, the Most Great.' },
  { s: 2, a: 285, ar: 'آمَنَ الرَّسُولُ بِمَا أُنزِلَ إِلَيْهِ مِن رَّبِّهِ وَالْمُؤْمِنُونَ كُلٌّ آمَنَ بِاللَّهِ وَمَلَائِكَتِهِ وَكُتُبِهِ وَرُسُلِهِ لَا نُفَرِّقُ بَيْنَ أَحَدٍ مِّن رُّسُلِهِ', en: 'The Messenger believes in what has been sent down to him from his Lord, and (so do) the believers. Each one believes in Allah, His Angels, His Books, and His Messengers. They say, "We make no distinction between one another of His Messengers."' },
  { s: 2, a: 286, ar: 'لَا يُكَلِّفُ اللَّهُ نَفْسًا إِلَّا وُسْعَهَا لَهَا مَا كَسَبَتْ وَعَلَيْهَا مَا اكْتَسَبَتْ', en: 'Allah burdens not a person beyond his scope. He gets reward for that (good) which he has earned, and he is punished for that (evil) which he has earned.' },

  // Al-Imran Key Ayat
  { s: 3, a: 31, ar: 'قُلْ إِن كُنتُمْ تُحِبُّونَ اللَّهَ فَاتَّبِعُونِي يُحْبِبْكُمُ اللَّهُ وَيَغْفِرْ لَكُمْ ذُنُوبَكُمْ وَاللَّهُ غَفُورٌ رَّحِيمٌ', en: 'Say (O Muhammad to mankind): "If you (really) love Allah then follow me, Allah will love you and forgive you of your sins. And Allah is Oft-Forgiving, Most Merciful."' },
  { s: 3, a: 102, ar: 'يَا أَيُّهَا الَّذِينَ آمَنُوا اتَّقُوا اللَّهَ حَقَّ تُقَاتِهِ وَلَا تَمُوتُنَّ إِلَّا وَأَنتُم مُّسْلِمُونَ', en: 'O you who believe! Fear Allah as He should be feared, and die not except in a state of Islam (as Muslims) with complete submission to Allah.' },
  { s: 3, a: 103, ar: 'وَاعْتَصِمُوا بِحَبْلِ اللَّهِ جَمِيعًا وَلَا تَفَرَّقُوا', en: 'And hold fast, all of you together, to the Rope of Allah (i.e. this Quran), and be not divided among yourselves.' },
  { s: 3, a: 110, ar: 'كُنتُمْ خَيْرَ أُمَّةٍ أُخْرِجَتْ لِلنَّاسِ تَأْمُرُونَ بِالْمَعْرُوفِ وَتَنْهَوْنَ عَنِ الْمُنكَرِ وَتُؤْمِنُونَ بِاللَّهِ', en: 'You are the best of peoples ever raised up for mankind; you enjoin Al-Maruf (all that Islam has ordained) and forbid Al-Munkar (all that Islam has forbidden), and you believe in Allah.' },
  { s: 3, a: 185, ar: 'كُلُّ نَفْسٍ ذَائِقَةُ الْمَوْتِ وَإِنَّمَا تُوَفَّوْنَ أُجُورَكُمْ يَوْمَ الْقِيَامَةِ', en: 'Everyone shall taste death. And only on the Day of Resurrection shall you be paid your wages in full.' },

  // An-Nisa Key Ayat
  { s: 4, a: 1, ar: 'يَا أَيُّهَا النَّاسُ اتَّقُوا رَبَّكُمُ الَّذِي خَلَقَكُم مِّن نَّفْسٍ وَاحِدَةٍ وَخَلَقَ مِنْهَا زَوْجَهَا وَبَثَّ مِنْهُمَا رِجَالًا كَثِيرًا وَنِسَاءً وَاتَّقُوا اللَّهَ الَّذِي تَسَاءَلُونَ بِهِ وَالْأَرْحَامَ إِنَّ اللَّهَ كَانَ عَلَيْكُمْ رَقِيبًا', en: 'O mankind! Be dutiful to your Lord, Who created you from a single person (Adam), and from him (Adam) He created his wife [Hawwa (Eve)], and from them both He created many men and women and fear Allah through Whom you demand your mutual (rights), and (do not cut the relations of) the wombs (kinship). Surely, Allah is Ever an All-Watcher over you.' },
  { s: 4, a: 59, ar: 'يَا أَيُّهَا الَّذِينَ آمَنُوا أَطِيعُوا اللَّهَ وَأَطِيعُوا الرَّسُولَ وَأُولِي الْأَمْرِ مِنكُمْ فَإِن تَنَازَعْتُمْ فِي شَيْءٍ فَرُدُّوهُ إِلَى اللَّهِ وَالرَّسُولِ إِن كُنتُمْ تُؤْمِنُونَ بِاللَّهِ وَالْيَوْمِ الْآخِرِ ذَٰلِكَ خَيْرٌ وَأَحْسَنُ تَأْوِيلًا', en: 'O you who believe! Obey Allah and obey the Messenger (Muhammad), and those of you (Muslims) who are in authority. (And) if you differ in anything amongst yourselves, refer it to Allah and His Messenger, if you believe in Allah and in the Last Day. That is better and more suitable for final determination.' },

  // Al-An'am & Al-A'raf Key Ayat
  { s: 6, a: 162, ar: 'قُلْ إِنَّ صَلَاتِي وَنُسُكِي وَمَحْيَايَ وَمَمَاتِي لِلَّهِ رَبِّ الْعَالَمِينَ', en: 'Say (O Muhammad): "Verily, my Salat (prayer), my sacrifice, my living, and my dying are for Allah, the Lord of the Alamin (mankind, jinns and all that exists)."' },
  { s: 6, a: 163, ar: 'لَا شَرِيكَ لَهُ وَبِذَٰلِكَ أُمِرْتُ وَأَنَا أَوَّلُ الْمُسْلِمِينَ', en: '"He has no partner. And of this I have been commanded, and I am the first of the Muslims."' },
  { s: 7, a: 54, ar: 'إِنَّ رَبَّكُمُ اللَّهُ الَّذِي خَلَقَ السَّمَاوَاتِ وَالْأَرْضَ فِي سِتَّةِ أَيَّامٍ ثُمَّ اسْتَوَىٰ عَلَى الْعَرْشِ', en: 'Indeed your Lord is Allah, Who created the heavens and the earth in Six Days, and then He rose over (Istawa) the Throne (really in a manner that suits His Majesty).' },

  // At-Tawbah & Yunus Key Ayat
  { s: 9, a: 128, ar: 'لَقَدْ جَاءَكُمْ رَسُولٌ مِّنْ أَنفُسِكُمْ عَزِيزٌ عَلَيْهِ مَا عَنِتُّمْ حَرِيصٌ عَلَيْكُم بِالْمُؤْمِنِينَ رَءُوفٌ رَّحِيمٌ', en: 'Verily, there has come unto you a Messenger (Muhammad) from amongst yourselves. It grieves him that you should receive any injury or difficulty. He is anxious over you (to be rightly guided); for the believers he is full of pity, kind, and merciful.' },
  { s: 9, a: 129, ar: 'فَإِن تَوَلَّوْا فَقُلْ حَسْبِيَ اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ عَلَيْهِ تَوَكَّلْتُ وَهُوَ رَبُّ الْعَرْشِ الْعَظِيمِ', en: 'But if they turn away, say (O Muhammad): "Allah is sufficient for me. La ilaha illa Huwa (none has the right to be worshipped but He), in Him I put my trust and He is the Lord of the Mighty Throne."' },

  // Al-Kahf Key Ayat
  { s: 18, a: 1, ar: 'الْحَمْدُ لِلَّهِ الَّذِي أَنزَلَ عَلَىٰ عَبْدِهِ الْكِتَابَ وَلَمْ يَجْعَل لَّهُ عِوَجًا', en: 'All the praises and thanks be to Allah, Who has sent down to His slave (Muhammad) the Book (the Quran), and has not placed therein any crookedness.' },
  { s: 18, a: 110, ar: 'قُلْ إِنَّمَا أَنَا بَشَرٌ مِّثْلُكُمْ يُوحَىٰ إِلَيَّ أَنَّمَا إِلَٰهُكُمْ إِلَٰهٌ وَاحِدٌ فَمَن كَانَ يَرْجُو لِقَاءَ رَبِّهِ فَلْيَعْمَلْ عَمَلًا صَالِحًا وَلَا يُشْرِكْ بِعِبَادَةِ رَبِّهِ أَحَدًا', en: 'Say (O Muhammad): "I am only a man like you. It has been inspired to me that your Ilah (God) is One Ilah (God - i.e. Allah). So whoever hopes for the Meeting with his Lord, let him work righteousness and associate none as a partner in the worship of his Lord."' },

  // Ta-Ha & Al-Anbiya Key Ayat
  { s: 20, a: 5, ar: 'الرَّحْمَٰنُ عَلَى الْعَرْشِ اسْتَوَىٰ', en: 'The Most Beneficent (Allah) Istawa (rose over) the (Mighty) Throne (in a manner that suits His Majesty).' },
  { s: 21, a: 107, ar: 'وَمَا أَرْسَلْنَاكَ إِلَّا رَحْمَةً لِّلْعَالَمِينَ', en: 'And We have sent you (O Muhammad) not but as a mercy for the Alamin (mankind, jinns and all that exists).' },

  // An-Nur & Al-Furqan Key Ayat
  { s: 24, a: 35, ar: 'اللَّهُ نُورُ السَّمَاوَاتِ وَالْأَرْضِ مَثَلُ نُورِهِ كَمِشْكَاةٍ فِيهَا مِصْبَاحٌ', en: 'Allah is the Light of the heavens and the earth. The parable of His Light is as (if there were) a niche and within it a lamp.' },
  { s: 25, a: 1, ar: 'تَبَارَكَ الَّذِي نَزَّلَ الْفُرْقَانَ عَلَىٰ عَبْدِهِ لِيَكُونَ لِلْعَالَمِينَ نَذِيرًا', en: 'Blessed be He Who sent down the criterion (of right and wrong, i.e. this Quran) to His slave (Muhammad) that he may be an admonisher to the Alamin (mankind and jinns).' },

  // Al-Ahzab Key Ayat
  { s: 33, a: 21, ar: 'لَّقَدْ كَانَ لَكُمْ فِي رَسُولِ اللَّهِ أُسْوَةٌ حَسَنَةٌ لِّمَن كَانَ يَرْجُو اللَّهَ وَالْيَوْمَ الْآخِرَ وَذَكَرَ اللَّهَ كَثِيرًا', en: 'Indeed in the Messenger of Allah (Muhammad) you have a good example to follow for him who hopes in (the Meeting with) Allah and the Last Day and remembers Allah much.' },
  { s: 33, a: 56, ar: 'إِنَّ اللَّهَ وَمَلَائِكَتَهُ يُصَلُّونَ عَلَى النَّبِيِّ يَا أَيُّهَا الَّذِينَ آمَنُوا صَلُّوا عَلَيْهِ وَسَلِّمُوا تَسْلِيمًا', en: 'Allah sends His Salat (Graces, Honours, Blessings, Mercy, etc.) on the Prophet (Muhammad) and also His angels too (ask Allah to bless and forgive him). O you who believe! Send your Salat on (ask Allah to bless) him (Muhammad), and (you should) greet (salute) him with the Islamic way of greeting (salutation, i.e. As-Salamu Alaikum).' },
  { s: 33, a: 70, ar: 'يَا أَيُّهَا الَّذِينَ آمَنُوا اتَّقُوا اللَّهَ وَقُولُوا قَوْلًا سَدِيدًا', en: 'O you who believe! Keep your duty to Allah and fear Him, and speak (always) the truth.' },
  { s: 33, a: 71, ar: 'يُصْلِحْ لَكُمْ أَعْمَالَكُمْ وَيَغْفِرْ لَكُمْ ذُنُوبَكُمْ وَمَن يُطِعِ اللَّهَ وَرَسُولَهُ فَقَدْ فَازَ فَوْزًا عَظِيمًا', en: 'He will direct you to do righteous good deeds and will forgive you your sins. And whosoever obeys Allah and His Messenger he has indeed achieved a great achievement (i.e. he will be saved from the Hell-fire and made to enter Paradise).' },

  // Ash-Shura & Muhammad Key Ayat
  { s: 42, a: 11, ar: 'لَيْسَ كَمِثْلِهِ شَيْءٌ وَهُوَ السَّمِيعُ الْبَصِيرُ', en: 'There is nothing like unto Him, and He is the All-Hearer, the All-Seer.' },
  { s: 47, a: 19, ar: 'فَاعْلَمْ أَنَّهُ لَا إِلَٰهَ إِلَّا اللَّهُ وَاسْتَغْفِرْ لِذَنبِكَ وَلِلْمُؤْمِنِينَ وَالْمُؤْمِنَاتِ', en: 'So know (O Muhammad) that La ilaha ill-Allah (none has the right to be worshipped but He), and ask forgiveness for your sin, and also for (the sin of) believing men and believing women.' },

  // Al-Hujurat Key Ayat
  { s: 49, a: 10, ar: 'إِنَّمَا الْمُؤْمِنُونَ إِخْوَةٌ فَأَصْلِحُوا بَيْنَ أَخَوَيْكُمْ وَاتَّقُوا اللَّهَ لَعَلَّكُمْ تُرْحَمُونَ', en: 'The believers are but a single brotherhood. So make reconciliation between your two contending brothers, and fear Allah, that you may receive mercy.' },
  { s: 49, a: 13, ar: 'يَا أَيُّهَا النَّاسُ إِنَّا خَلَقْنَاكُم مِّن ذَكَرٍ وَأُنثَىٰ وَجَعَلْنَاكُمْ شُعُوبًا وَقَبَائِلَ لِتَعَارَفُوا إِنَّ أَكْرَمَكُمْ عِندَ اللَّهِ أَتْقَاكُمْ إِنَّ اللَّهَ عَلِيمٌ خَبِيرٌ', en: 'O mankind! We have created you from a male and a female, and made you into nations and tribes, that you may know one another. Verily, the most honourable of you with Allah is that (believer) who has At-Taqwa. Verily, Allah is All-Knowing, All-Aware.' },

  // Adh-Dhariyat Key Ayat
  { s: 51, a: 56, ar: 'وَمَا خَلَقْتُ الْجِنَّ وَالْإِنسَ إِلَّا لِيَعْبُدُونِ', en: 'And I (Allah) created not the jinns and humans except they should worship Me (Alone).' },

  // Al-Hashr Key Ayat
  { s: 59, a: 7, ar: 'وَمَا آتَاكُمُ الرَّسُولُ فَخُذُوهُ وَمَا نَهَاكُمْ عَنْهُ فَانتَهُوا وَاتَّقُوا اللَّهَ إِنَّ اللَّهَ شَدِيدُ الْعِقَابِ', en: 'And whatsoever the Messenger (Muhammad) gives you, take it, and whatsoever he forbids you, abstain (from it), and fear Allah. Verily, Allah is Severe in punishment.' },
  { s: 59, a: 22, ar: 'هُوَ اللَّهُ الَّذِي لَا إِلَٰهَ إِلَّا هُوَ عَالِمُ الْغَيْبِ وَالشَّهَادَةِ هُوَ الرَّحْمَٰنُ الرَّحِيمُ', en: 'He is Allah, than Whom there is La ilaha illa Huwa (none has the right to be worshipped but He) the All-Knower of the unseen and the seen (open). He is the Most Beneficent, the Most Merciful.' },
  { s: 59, a: 23, ar: 'هُوَ اللَّهُ الَّذِي لَا إِلَٰهَ إِلَّا هُوَ الْمَلِكُ الْقُدُّوسُ السَّلَامُ الْمُؤْمِنُ الْمُهَيْمِنُ الْعَزِيزُ الْجَبَّارُ الْمُتَكَبِّرُ سُبْحَانَ اللَّهِ عَمَّا يُشْرِكُونَ', en: 'He is Allah than Whom there is La ilaha illa Huwa (none has the right to be worshipped but He) the King, the Holy, the One Free from all defects, the Giver of security, the Watcher over His creatures, the All-Mighty, the Compeller, the Supreme. Glory be to Allah! (High is He) above all that they associate as partners with Him.' },
  { s: 59, a: 24, ar: 'هُوَ اللَّهُ الْخَالِقُ الْبَارِئُ الْمُصَوِّرُ لَهُ الْأَسْمَاءُ الْحُسْنَىٰ يُسَبِّحُ لَهُ مَا فِي السَّمَاوَاتِ وَالْأَرْضِ وَهُوَ الْعَزِيزُ الْحَكِيمُ', en: 'He is Allah, the Creator, the Inventor of all things, the Bestower of forms. To Him belong the Best Names. All that is in the heavens and the earth glorify Him. And He is the All-Mighty, the All-Wise.' },

  // Al-Mulk Key Ayat
  { s: 67, a: 1, ar: 'تَبَارَكَ الَّذِي بِيَدِهِ الْمُلْكُ وَهُوَ عَلَىٰ كُلِّ شَيْءٍ قَدِيرٌ', en: 'Blessed is He in Whose Hand is the dominion, and He is Able to do all things.' },
  { s: 67, a: 2, ar: 'الَّذِي خَلَقَ الْمَوْتَ وَالْحَيَاةَ لِيَبْلُوَكُمْ أَيُّكُمْ أَحْسَنُ عَمَلًا وَهُوَ الْعَزِيزُ الْغَفُورُ', en: 'Who has created death and life, that He may test you which of you is best in deed. And He is the All-Mighty, the Oft-Forgiving.' },

  // Al-Asr (103:1-3)
  { s: 103, a: 1, ar: 'وَالْعَصْرِ', en: 'By Al-Asr (the time).' },
  { s: 103, a: 2, ar: 'إِنَّ الْإِنسَانَ لَفِي خُسْرٍ', en: 'Verily! Man is in loss.' },
  { s: 103, a: 3, ar: 'إِلَّا الَّذِينَ آمَنُوا وَعَمِلُوا الصَّالِحَاتِ وَتَوَاصَوْا بِالْحَقِّ وَتَوَاصَوْا بِالصَّبْرِ', en: 'Except those who believe and do righteous good deeds, and recommend one another to the truth, and recommend one another to patience.' },

  // Al-Ikhlas (112:1-4)
  { s: 112, a: 1, ar: 'قُلْ هُوَ اللَّهُ أَحَدٌ', en: 'Say (O Muhammad): "He is Allah, (the) One."' },
  { s: 112, a: 2, ar: 'اللَّهُ الصَّمَدُ', en: '"Allah-us-Samad (The Self-Sufficient Master, Whom all creatures need)."' },
  { s: 112, a: 3, ar: 'لَمْ يَلِدْ وَلَمْ يُولَدْ', en: '"He begets not, nor was He begotten;"' },
  { s: 112, a: 4, ar: 'وَلَمْ يَكُن لَّهُ كُفُوًا أَحَدٌ', en: '"And there is none co-equal or comparable unto Him."' },

  // Al-Falaq (113:1-5)
  { s: 113, a: 1, ar: 'قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ', en: 'Say: "I seek refuge with (Allah) the Lord of the daybreak,"' },
  { s: 113, a: 2, ar: 'مِن شَرِّ مَا خَلَقَ', en: '"From the evil of what He has created;"' },
  { s: 113, a: 3, ar: 'وَمِن شَرِّ غَاسِقٍ إِذَا وَقَبَ', en: '"And from the evil of the darkening (night) as it comes with its darkness;"' },
  { s: 113, a: 4, ar: 'وَمِن شَرِّ النَّفَّاثَاتِ فِي الْعُقَدِ', en: '"And from the evil of the witchcrafts when they blow in the knots,"' },
  { s: 113, a: 5, ar: 'وَمِن شَرِّ حَاسِدٍ إِذَا حَسَدَ', en: '"And from the evil of the envier when he envies."' },

  // An-Nas (114:1-6)
  { s: 114, a: 1, ar: 'قُلْ أَعُوذُ بِرَبِّ النَّاسِ', en: 'Say: "I seek refuge with (Allah) the Lord of mankind,"' },
  { s: 114, a: 2, ar: 'مَلِكِ النَّاسِ', en: '"The King of mankind,"' },
  { s: 114, a: 3, ar: 'إِلَٰهِ النَّاسِ', en: '"The Ilah (God) of mankind,"' },
  { s: 114, a: 4, ar: 'مِن شَرِّ الْوَسْوَاسِ الْخَنَّاسِ', en: '"From the evil of the whisperer who withdraws,"' },
  { s: 114, a: 5, ar: 'الَّذِي يُوَسْوِسُ فِي صُدُورِ النَّاسِ', en: '"Who whispers in the breasts of mankind,"' },
  { s: 114, a: 6, ar: 'مِنَ الْجِنَّةِ وَالنَّاسِ', en: '"Of jinns and men."' },
];
