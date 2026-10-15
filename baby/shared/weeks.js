/* BattyDev · Baby — pregnancy reference content
   General information only, keyed by completed gestational week (counted from
   the first day of the last period, which is how a due date is dated). It is
   deliberately date-free: nothing in this file says *when* any of it happens.
   The pages turn weeks into calendar dates only after decrypting the due date,
   so this can ship in the clear without saying anything about this family.

   Sizes are population averages and vary a lot between babies. Length is
   crown-to-rump until week 20 and crown-to-heel after, which is why it jumps.
   Schedules follow common US practice (ACOG/CDC); the OB's plan always wins.
   The "dad" lines draw on the usual expectant-father advice (The Expectant
   Father, The Birth Partner, and what OBs and classes tell partners). */

'use strict';

const BABY_WEEKS = {
  4: {
    size: 'poppy seed', len: '0.04 in', wt: '—',
    baby: 'The fertilized egg has implanted and is splitting into the cells that become the embryo and the placenta.',
    mom: 'A missed period is often the first sign; a home test can turn positive as hCG climbs.',
    dad: 'It may not feel real yet, and that is normal. For a lot of dads it clicks at the first ultrasound.',
  },
  5: {
    size: 'sesame seed', len: '0.1 in', wt: '—',
    baby: 'The neural tube (future brain and spinal cord) is forming and the heart is starting to take shape.',
    mom: 'Fatigue, sore breasts and the first wave of nausea commonly start around now.',
    dad: 'The tiredness hits early and hard. Pick up the slack at home before you are asked.',
  },
  6: {
    size: 'lentil', len: '0.25 in', wt: '—',
    baby: 'A tiny heart tube has begun to beat, and the outlines of the face are appearing.',
    mom: 'Morning sickness (any time of day) and needing to pee more often are typical.',
    dad: 'Nausea is often worst from weeks 6 to 10. Learn what she can stomach and keep it stocked.',
  },
  7: {
    size: 'blueberry', len: '0.5 in', wt: '—',
    baby: 'The brain is growing quickly and arm and leg buds have appeared.',
    mom: 'Food aversions, a heightened sense of smell and extra saliva are common.',
    dad: 'Start a running list of questions for the first appointment, so you are part of it, not a passenger.',
  },
  8: {
    size: 'raspberry', len: '0.6 in', wt: '< 0.1 oz',
    baby: 'Fingers and toes are forming, still webbed. The embryo is moving, far too small to feel.',
    mom: 'Many first prenatal visits happen between weeks 8 and 10, often with a dating ultrasound.',
    dad: 'Go to the first appointment if you possibly can: there may be a heartbeat to hear.',
  },
  9: {
    size: 'cherry', len: '0.9 in', wt: '0.1 oz',
    baby: 'Every essential organ has started to form. Tiny muscles let the embryo shift position.',
    mom: 'Hormones peak around here: mood swings, bloating and exhaustion are all normal.',
    dad: 'Some dads get sympathy symptoms (couvade): queasiness, weight gain, bad sleep. Common, real, and it passes.',
  },
  10: {
    size: 'strawberry', len: '1.2 in', wt: '0.14 oz',
    baby: 'Officially a fetus now. Vital organs are in place and starting to work; nails are beginning.',
    mom: 'The NIPT blood screen is available from week 10. Veins may look more visible.',
    dad: 'Talk about who to tell, and when. Many couples wait until the end of the first trimester.',
  },
  11: {
    size: 'fig', len: '1.6 in', wt: '0.25 oz',
    baby: 'Hands open and close, tooth buds are forming, and the head is still about half the body length.',
    mom: 'For some, nausea starts to ease. The nuchal translucency scan window opens (weeks 11 to 14).',
    dad: 'Start the money conversation: insurance costs, leave, and the savings goals on this site.',
  },
  12: {
    size: 'lime', len: '2.1 in', wt: '0.5 oz',
    baby: 'Reflexes are developing (fingers curl, toes flex) and the kidneys have started making urine.',
    mom: 'The uterus is rising above the pelvic bone. Miscarriage risk drops considerably from here.',
    dad: 'If you have been holding your breath, this is a good week to let some of it out.',
  },
  13: {
    size: 'lemon', len: '2.9 in', wt: '0.8 oz',
    baby: 'Vocal cords are forming and fingerprints are starting to take shape.',
    mom: 'The last week of the first trimester. Energy often starts coming back.',
    dad: 'Read your employer\'s parental-leave policy and note what it needs from you, and by when.',
  },
  14: {
    size: 'peach', len: '3.4 in', wt: '1.5 oz',
    baby: 'Facial muscles work now: squinting, frowning, grimacing. Fine hair (lanugo) is growing.',
    mom: 'The second trimester, often the most comfortable stretch of the whole pregnancy.',
    dad: 'Energy usually comes back now. Plan a few things together while it is easy to.',
  },
  15: {
    size: 'apple', len: '4 in', wt: '2.5 oz',
    baby: 'The skeleton is hardening from cartilage to bone, and the eyes can sense light through the lids.',
    mom: 'A stuffy nose or nosebleeds are common: more blood volume swells the nasal passages.',
    dad: 'Start the names list. It takes longer than anyone expects.',
  },
  16: {
    size: 'avocado', len: '4.6 in', wt: '3.5 oz',
    baby: 'The eyes make small movements and the heart pumps around 25 quarts of blood a day.',
    mom: 'First flutters ("quickening") can come between weeks 16 and 22. Round-ligament twinges are normal.',
    dad: 'Ask her to tell you when she feels a flutter. You cannot feel it yet, but you can share it.',
  },
  17: {
    size: 'pear', len: '5.1 in', wt: '5 oz',
    baby: 'Fat is starting to build under the skin and the umbilical cord is getting thicker.',
    mom: 'Appetite is usually up and the bump is getting harder to hide.',
    dad: 'Research the big-ticket items now (crib, stroller, car seat), not in month eight.',
  },
  18: {
    size: 'bell pepper', len: '5.6 in', wt: '6.7 oz',
    baby: 'The ears are in their final position and the baby may start hearing sounds.',
    mom: 'The anatomy scan usually falls between weeks 18 and 22.',
    dad: 'Talk, read or sing to the bump. Your voice is one the baby will learn before birth.',
  },
  19: {
    size: 'mango', len: '6 in', wt: '8.5 oz',
    baby: 'A waxy coating (vernix) is forming to protect the skin from the amniotic fluid.',
    mom: 'Back aches and dizziness when standing up quickly are common.',
    dad: 'A back rub or foot rub goes a long way. Ask what actually helps.',
  },
  20: {
    size: 'banana', len: '10 in', wt: '10.6 oz',
    baby: 'Halfway. The baby swallows and digests amniotic fluid, building up the first stool (meconium).',
    mom: 'The top of the uterus reaches about the belly button.',
    dad: 'Halfway. The anatomy scan is around now: block the time and go. For many dads this is when it gets real.',
  },
  21: {
    size: 'carrot', len: '10.5 in', wt: '12.7 oz',
    baby: 'Movements are stronger and more coordinated.',
    mom: 'Kicks become easier to feel. From outside, it can still take until week 24 or so.',
    dad: 'Keep a hand on the bump in the evenings; that is often when the baby is most active.',
  },
  22: {
    size: 'papaya', len: '11 in', wt: '15 oz',
    baby: 'Eyebrows and lips are distinct, and the eyes have formed (the irises have no color yet).',
    mom: 'Stretch marks and swollen feet may appear.',
    dad: 'Sign up for a childbirth class. They fill up, and partners are expected to be there.',
  },
  23: {
    size: 'grapefruit', len: '11.4 in', wt: '1.1 lb',
    baby: 'Hearing is getting sharper: loud noises can startle the baby.',
    mom: 'Braxton Hicks "practice" contractions may start. They are irregular and painless.',
    dad: 'Plan where the baby sleeps for the first months (usually your room) and what has to move.',
  },
  24: {
    size: 'ear of corn', len: '11.8 in', wt: '1.3 lb',
    baby: 'The lungs are developing the cells that make surfactant, which they need to breathe air.',
    mom: 'The glucose screening test for gestational diabetes is usually done in weeks 24 to 28.',
    dad: 'You may be able to feel kicks from outside now. Be patient; the baby has opinions about timing.',
  },
  25: {
    size: 'cauliflower', len: '13.6 in', wt: '1.5 lb',
    baby: 'The baby responds to familiar voices and is putting on fat steadily.',
    mom: 'Heartburn and restless legs are common complaints.',
    dad: 'Shortlist pediatricians. Most families pick one before the birth so the hospital knows who to call.',
  },
  26: {
    size: 'head of lettuce', len: '14 in', wt: '1.7 lb',
    baby: 'The eyes are beginning to open.',
    mom: 'Sleep gets harder to come by. Side-sleeping with a pillow between the knees helps.',
    dad: 'A good body pillow is about the best-value gift there is right now.',
  },
  27: {
    size: 'head of cabbage', len: '14.4 in', wt: '1.9 lb',
    baby: 'Regular sleep and wake cycles are setting in.',
    mom: 'The last week of the second trimester. The Tdap vaccine window (weeks 27 to 36) opens.',
    dad: 'Check whether you (and the grandparents) are up to date on Tdap and flu shots too.',
  },
  28: {
    size: 'eggplant', len: '14.8 in', wt: '2.2 lb',
    baby: 'The eyes can blink, and REM (dreaming) sleep has started.',
    mom: 'The third trimester. Visits move to every 2 weeks; daily kick counts are often suggested.',
    dad: 'Learn the kick-count routine so you can help track it in the evenings.',
  },
  29: {
    size: 'butternut squash', len: '15.2 in', wt: '2.5 lb',
    baby: 'Bones are fully formed but soft; muscles and lungs keep maturing.',
    mom: 'Shortness of breath as the uterus presses up on the diaphragm.',
    dad: 'Build the crib and the big furniture now, while there is no deadline breathing on you.',
  },
  30: {
    size: 'cucumber', len: '15.7 in', wt: '2.9 lb',
    baby: 'The brain is growing fast, and the lanugo hair is starting to shed.',
    mom: 'First-trimester-style fatigue often comes back. Swelling is common.',
    dad: 'Talk about the first weeks home: visitors, night feeds, and who does what.',
  },
  31: {
    size: 'coconut', len: '16.2 in', wt: '3.3 lb',
    baby: 'All five senses are working.',
    mom: 'Leaking colostrum and more frequent Braxton Hicks are both normal.',
    dad: 'Plan for her recovery, not just the baby: postpartum supplies, meals, and help.',
  },
  32: {
    size: 'jicama', len: '16.7 in', wt: '3.8 lb',
    baby: 'The baby is practicing breathing and has toenails. Most turn head-down around now.',
    mom: 'A good time for a hospital tour and childbirth classes.',
    dad: 'Tour the hospital and pre-register, so the paperwork is done before anyone is in labor.',
  },
  33: {
    size: 'pineapple', len: '17.2 in', wt: '4.2 lb',
    baby: 'The immune system is developing, with antibodies passing over from mom.',
    mom: 'Pelvic pressure and insomnia are common.',
    dad: 'Talk through the birth plan, and what she wants from you as the birth partner.',
  },
  34: {
    size: 'cantaloupe', len: '17.7 in', wt: '4.7 lb',
    baby: 'The central nervous system and lungs are still maturing.',
    mom: 'Fatigue is common. Time to get the hospital bag packed.',
    dad: 'Install the car seat and have a certified technician check it. Not in the hospital parking lot.',
  },
  35: {
    size: 'honeydew melon', len: '18.2 in', wt: '5.3 lb',
    baby: 'The kidneys are fully developed and the liver can process some waste.',
    mom: 'Less room means movements feel more like rolls and stretches than kicks.',
    dad: 'Pack the bags: hers, the baby\'s, and yours (snacks, chargers, a change of clothes).',
  },
  36: {
    size: 'romaine lettuce', len: '18.7 in', wt: '5.8 lb',
    baby: 'The baby is shedding most of its vernix and lanugo and may "drop" lower into the pelvis.',
    mom: 'Weekly visits begin. The Group B strep swab is done between weeks 36 and 37.',
    dad: 'Learn which signs mean "call the doctor" and which mean "go in now".',
  },
  37: {
    size: 'winter melon', len: '19.1 in', wt: '6.3 lb',
    baby: '"Early term." The baby is practicing sucking, blinking and grasping.',
    mom: 'Losing the mucus plug is a sign things are getting close, but labor can still be weeks off.',
    dad: 'Phone charged, tank full, route planned, and a backup ride lined up.',
  },
  38: {
    size: 'leek', len: '19.6 in', wt: '6.8 lb',
    baby: 'A firm grip is ready for your finger.',
    mom: 'Nesting urges and more frequent contractions.',
    dad: 'Freezer meals and a clean house now will feel like a gift in two weeks.',
  },
  39: {
    size: 'mini watermelon', len: '20 in', wt: '7.3 lb',
    baby: 'Full term. The brain and lungs keep maturing right up to birth.',
    mom: 'Watch for labor signs: regular contractions, waters breaking, or anything that feels off.',
    dad: 'Full term. Rest when you can; you are on call now.',
  },
  40: {
    size: 'small pumpkin', len: '20.2 in', wt: '7.6 lb',
    baby: 'Due date! Only about 1 in 20 babies actually arrives on it.',
    mom: 'If nothing is happening, expect extra monitoring and a talk about induction.',
    dad: 'Most babies ignore the due date. Keep plans loose and stay close.',
  },
  41: {
    size: 'watermelon', len: '20.5 in', wt: '8 lb',
    baby: '"Late term." Still growing.',
    mom: 'Closer monitoring, and induction is usually discussed or scheduled.',
    dad: 'The waiting is hard on her too. Be the steady one.',
  },
};

/* Pregnancy months as most apps count them, in the same "weeks pregnant"
   (completed weeks) as BABY_WEEKS, so month 3 is "9 to 13 weeks pregnant".
   Month 9 runs to the due date; a late baby spills past it. */
const BABY_MONTHS = [
  { n: 1, from: 0,  to: 4,
    baby: 'Conception and implantation. By the end, a cluster of cells smaller than a poppy seed.',
    mom: 'Most people do not know yet. A missed period at the end of the month is often the first clue.',
    dad: 'The news lands. Excitement, fear and "wait, really?" all at once is the normal mix.' },
  { n: 2, from: 5,  to: 8,
    baby: 'The heart starts beating, arm and leg buds appear, and every major organ begins forming.',
    mom: 'Nausea, exhaustion, sore breasts and mood swings, often while keeping it secret at work.',
    dad: 'Feeling on the sidelines is common, because everything is happening to her. Show up: appointments, chores, crackers.' },
  { n: 3, from: 9,  to: 13,
    baby: 'Now a fetus. Organs are formed and starting to work; reflexes appear; it moves constantly, too small to feel.',
    mom: 'Nausea often peaks and then starts to ease by the end of the month. The first screening tests happen.',
    dad: 'Decide on announcing, and start the money talk. Sympathy symptoms are a real thing for some dads.' },
  { n: 4, from: 14, to: 17,
    baby: 'Makes faces, starts to grow hair, and the skeleton hardens. Roughly the size of an avocado.',
    mom: 'Energy comes back and the bump shows. Often the best month of the whole pregnancy.',
    dad: 'Good window for names, the registry, and maybe a trip together while travel is easy.' },
  { n: 5, from: 18, to: 22,
    baby: 'Can hear, is coated in vernix, and kicks hard enough for mom to feel.',
    mom: 'The anatomy scan, and the first definite movements.',
    dad: 'Often the month it gets real for dads: you see the whole baby on the anatomy scan. Book the childbirth class.' },
  { n: 6, from: 23, to: 27,
    baby: 'Lungs are developing and the baby responds to familiar voices. Gaining weight steadily.',
    mom: 'Glucose test, Braxton Hicks, heartburn, and sleep getting harder.',
    dad: 'You can feel kicks from outside. Shortlist pediatricians and look at childcare if you will need it.' },
  { n: 7, from: 28, to: 31,
    baby: 'Eyes open, dreams in REM sleep, and puts on weight fast.',
    mom: 'The third trimester: visits every two weeks, kick counts, swelling and fatigue.',
    dad: 'Build the nursery and do the grown-up admin: beneficiaries, life insurance, a will and guardian.' },
  { n: 8, from: 32, to: 35,
    baby: 'Most babies turn head-down and practice breathing. Running out of room.',
    mom: 'Breathless, tired, uncomfortable, and nesting.',
    dad: 'Car seat installed and checked, hospital tour, bags packed. Nerves about labor are normal; learning what to expect helps most.' },
  { n: 9, from: 36, to: 40,
    baby: 'Early term at 37 weeks, full term at 39. Brain and lungs keep maturing to the end.',
    mom: 'Weekly visits, the strep test, and a lot of waiting.',
    dad: 'You are on call. Your job in labor is to be calm, to advocate for her, and to keep the outside world away.' },
];

/* The partner's prep list. `week` is when it is usually worth doing; the page
   flags anything still open once its week has passed. `id` is what the data
   file's progress.done list refers to, so never rename one. */
const BABY_TASKS = [
  { id: 'first-appointment', week: 8,  title: 'Go to the first prenatal appointment' },
  { id: 'insurance',         week: 10, title: 'Check insurance: prenatal care, delivery, breast pump', detail: 'Pumps are usually covered under the ACA.' },
  { id: 'budget',            week: 12, title: 'Set the baby budget and savings goals' },
  { id: 'announce',          week: 13, title: 'Decide when and how to tell people' },
  { id: 'leave-policy',      week: 13, title: 'Read the parental-leave policy and note its deadlines' },
  { id: 'names',             week: 16, title: 'Start the names list' },
  { id: 'research-gear',     week: 17, title: 'Research crib, stroller and car seat', detail: 'Some take weeks to arrive.' },
  { id: 'registry',          week: 18, title: 'Start the registry', detail: 'Showers usually land around weeks 28 to 34.' },
  { id: 'anatomy-scan',      week: 20, title: 'Go to the anatomy scan' },
  { id: 'childbirth-class',  week: 22, title: 'Sign up for a childbirth class' },
  { id: 'childcare',         week: 24, title: 'Look at childcare and waitlists, if needed', detail: 'Some waitlists are months long.' },
  { id: 'pediatrician',      week: 26, title: 'Shortlist and meet pediatricians' },
  { id: 'tdap',              week: 27, title: 'Tdap for her; check yours and the grandparents\'' },
  { id: 'admin',             week: 28, title: 'Update beneficiaries, life insurance, will and guardian' },
  { id: 'nursery',           week: 29, title: 'Set up the sleep space and nursery' },
  { id: 'cpr-class',         week: 30, title: 'Take an infant CPR / newborn-care class' },
  { id: 'first-weeks-plan',  week: 31, title: 'Plan the first weeks home: visitors, nights, meals' },
  { id: 'hospital-tour',     week: 32, title: 'Tour and pre-register at the hospital' },
  { id: 'birth-plan',        week: 33, title: 'Talk through the birth plan and your role in it' },
  { id: 'car-seat',          week: 34, title: 'Install the car seat and get it inspected' },
  { id: 'bags',              week: 35, title: 'Pack the hospital bags' },
  { id: 'leave-filed',       week: 35, title: 'File the leave paperwork at work' },
  { id: 'labor-signs',       week: 36, title: 'Learn the labor signs and when to call' },
  { id: 'freezer-meals',     week: 37, title: 'Stock the freezer' },
  { id: 'route',             week: 37, title: 'Plan the drive, plus a backup ride' },
  { id: 'add-to-insurance',  week: 40, title: 'After birth: add the baby to health insurance', detail: 'Usually within 30 days of the birth.' },
  { id: 'ppd-signs',         week: 40, title: 'Know the signs of postpartum depression, hers and yours', detail: 'Around 1 in 10 new dads get it too.' },
];

/* Typical prenatal milestones as gestational-week ranges [from, to). Where one
   is a single moment, `to` is from + 1. */
const BABY_MILESTONES = [
  { from: 8,  to: 11, label: 'First prenatal visit', note: 'Dating ultrasound, bloodwork, maybe a heartbeat.' },
  { from: 10, to: 14, label: 'NIPT blood screen',     note: 'Optional cell-free DNA screen; can also reveal sex.' },
  { from: 11, to: 14, label: 'Nuchal translucency scan', note: 'Optional first-trimester screen.' },
  { from: 14, to: 15, label: 'Second trimester',      note: '' },
  { from: 16, to: 22, label: 'First flutters',        note: 'Mom may feel movement; outside kicks come later.' },
  { from: 18, to: 23, label: 'Anatomy scan',          note: 'Detailed ultrasound of every organ.' },
  { from: 20, to: 21, label: 'Halfway',               note: '' },
  { from: 24, to: 29, label: 'Glucose screening',     note: 'Gestational diabetes test.' },
  { from: 27, to: 37, label: 'Tdap vaccine',          note: 'Passes whooping-cough protection to the baby.' },
  { from: 28, to: 29, label: 'Third trimester',       note: 'Visits every 2 weeks; Rh shot if needed.' },
  { from: 36, to: 38, label: 'Group B strep test',    note: 'Weekly visits from 36.' },
  { from: 37, to: 38, label: 'Early term',            note: '' },
  { from: 39, to: 40, label: 'Full term',             note: '' },
  { from: 40, to: 41, label: 'Due date',              note: '' },
];
