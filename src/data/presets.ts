import { DatasetPreset, RawEvent } from '../types/curation';

function createRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function generateEcommercePreset(): DatasetPreset {
  const rng = createRng(42071);
  const actions = [
    { id: 0, label: 'Organic' },
    { id: 1, label: '10% Promo' },
    { id: 2, label: 'Free Shipping' },
    { id: 3, label: 'VIP Bundle' },
  ];
  const channels = ['Web', 'Mobile App', 'Email'];
  const events: RawEvent[] = [];
  const entityCount = 210;

  for (let u = 0; u < entityCount; u++) {
    const entityId = `ENT-${String(1001 + u).padStart(4, '0')}`;
    const acqMonthIdx = Math.floor(rng() * 5); // Acquisition cohorts Month 1..5 (Days 1..150)
    const cohortQualityShift = [1.04, 0.98, 1.18, 0.94, 0.85][acqMonthIdx];
    const latentValue = (0.4 + rng() * 2.1) * cohortQualityShift; // customer propensity multiplier
    const churnHazard = 0.08 + rng() * 0.28;
    let currentDay = acqMonthIdx * 30 + Math.floor(rng() * 28) + 1;
    let freq = 0;
    let prevDay = currentDay;
    const maxEvents = 5 + Math.floor(rng() * 14);

    for (let step = 0; step < maxEvents; step++) {
      if (currentDay > 360) break;
      freq += 1;
      const recency = step === 0 ? 0 : currentDay - prevDay;
      const engagement = Math.min(
        1,
        Math.max(0.05, 0.25 + latentValue * 0.24 - recency * 0.004 + (rng() - 0.5) * 0.22)
      );

      // Behavior policy with realistic confounding (higher value users see more VIP/Organic)
      const r = rng();
      let actionId = 0;
      let propensity = 0.42;
      if (engagement > 0.65 && r < 0.36) {
        actionId = 3;
        propensity = 0.36;
      } else if (recency > 28 && r < 0.48) {
        actionId = 1;
        propensity = 0.48;
      } else if (r < 0.24) {
        actionId = 2;
        propensity = 0.24;
      } else {
        actionId = 0;
        propensity = 0.42;
      }

      const promoBoost = actionId === 1 ? 1.18 : actionId === 2 ? 1.12 : actionId === 3 ? 1.45 : 1.0;
      const spend = Math.max(
        12,
        Math.round((28 + latentValue * 42 * promoBoost + (rng() - 0.35) * 32) * 100) / 100
      );
      const marginCost = actionId === 1 ? spend * 0.1 : actionId === 2 ? 6.5 : actionId === 3 ? spend * 0.06 : 0;
      const reward = Math.round((spend * 0.34 - marginCost) * 100) / 100;

      events.push({
        eventId: `EV-${u}-${step}`,
        entityId,
        timestampDay: currentDay,
        actionId,
        actionLabel: actions[actionId].label,
        channel: channels[Math.floor(rng() * channels.length)],
        recencyDays: recency,
        frequencyCount: freq,
        spendAmount: spend,
        engagementScore: Math.round(engagement * 1000) / 1000,
        reward,
        propensity: Math.round(propensity * 1000) / 1000,
      });

      prevDay = currentDay;
      if (rng() < churnHazard && step >= 2) {
        // Long gap simulating churn or dormancy
        currentDay += 65 + Math.floor(rng() * 55);
      } else {
        currentDay += 6 + Math.floor(rng() * 28);
      }
    }
  }

  return {
    id: 'ecommerce_ltv_rl',
    name: 'E-Commerce Retention & Promo Log',
    domain: 'Retail Commerce',
    description:
      'Multi-touch purchase and promotional intervention stream across 210 customers over 360 days.',
    actionSpace: actions,
    horizonTotalDays: 360,
    defaultObsCutoffDay: 180,
    defaultHorizonDays: 180,
    events,
  };
}

function generateSaasPreset(): DatasetPreset {
  const rng = createRng(89123);
  const actions = [
    { id: 0, label: 'No Touch' },
    { id: 1, label: 'Onboarding Call' },
    { id: 2, label: 'Seat Upsell' },
    { id: 3, label: 'Annual Lock-in' },
  ];
  const channels = ['Workspace', 'Billing API', 'CSM Console'];
  const events: RawEvent[] = [];
  const entityCount = 165;

  for (let u = 0; u < entityCount; u++) {
    const entityId = `ORG-${String(2001 + u).padStart(4, '0')}`;
    const acqMonthIdx = Math.floor(rng() * 5);
    const cohortShift = [0.96, 1.12, 1.05, 0.92, 0.88][acqMonthIdx];
    const tierScale = (0.6 + rng() * 2.4) * cohortShift;
    let currentDay = acqMonthIdx * 30 + Math.floor(rng() * 28) + 1;
    let prevDay = currentDay;
    let freq = 0;
    const maxEvents = 4 + Math.floor(rng() * 12);

    for (let step = 0; step < maxEvents; step++) {
      if (currentDay > 360) break;
      freq += 1;
      const recency = step === 0 ? 0 : currentDay - prevDay;
      const engagement = Math.min(
        1,
        Math.max(0.08, 0.35 + tierScale * 0.2 - recency * 0.003 + (rng() - 0.5) * 0.18)
      );

      const r = rng();
      let actionId = 0;
      let propensity = 0.52;
      if (step <= 1 && r < 0.44) {
        actionId = 1;
        propensity = 0.44;
      } else if (engagement > 0.7 && r < 0.32) {
        actionId = 2;
        propensity = 0.32;
      } else if (freq >= 5 && r < 0.22) {
        actionId = 3;
        propensity = 0.22;
      }

      const upsellFactor = actionId === 2 ? 1.35 : actionId === 3 ? 1.2 : 1.0;
      const mrr = Math.round((75 + tierScale * 140 * upsellFactor + (rng() - 0.3) * 45) * 100) / 100;
      const touchCost = actionId === 1 ? 32 : actionId === 3 ? mrr * 0.08 : 0;
      const reward = Math.round((mrr * 0.72 - touchCost) * 100) / 100;

      events.push({
        eventId: `SAAS-${u}-${step}`,
        entityId,
        timestampDay: currentDay,
        actionId,
        actionLabel: actions[actionId].label,
        channel: channels[Math.floor(rng() * channels.length)],
        recencyDays: recency,
        frequencyCount: freq,
        spendAmount: mrr,
        engagementScore: Math.round(engagement * 1000) / 1000,
        reward,
        propensity: Math.round(propensity * 1000) / 1000,
      });

      prevDay = currentDay;
      currentDay += 14 + Math.floor(rng() * 24);
    }
  }

  return {
    id: 'saas_lifecycle',
    name: 'SaaS Subscription Lifecycle',
    domain: 'B2B SaaS',
    description:
      'Monthly seat expansion, onboarding touchpoints, and net-dollar-retention telemetry across 165 accounts.',
    actionSpace: actions,
    horizonTotalDays: 360,
    defaultObsCutoffDay: 180,
    defaultHorizonDays: 180,
    events,
  };
}

function generateFintechPreset(): DatasetPreset {
  const rng = createRng(19405);
  const actions = [
    { id: 0, label: 'Hold Line' },
    { id: 1, label: 'Limit Bump' },
    { id: 2, label: 'Cashback Offer' },
    { id: 3, label: 'APR Reduction' },
  ];
  const channels = ['Card Rail', 'Mobile Banking', 'Underwriting'];
  const events: RawEvent[] = [];
  const entityCount = 190;

  for (let u = 0; u < entityCount; u++) {
    const entityId = `ACC-${String(3001 + u).padStart(4, '0')}`;
    const acqMonthIdx = Math.floor(rng() * 5);
    const vintageShift = [1.05, 1.0, 1.14, 0.93, 0.87][acqMonthIdx];
    const creditQuality = Math.min(1, Math.max(0.2, (0.3 + rng() * 0.7) * vintageShift));
    let currentDay = acqMonthIdx * 30 + Math.floor(rng() * 28) + 1;
    let prevDay = currentDay;
    let freq = 0;
    const maxEvents = 5 + Math.floor(rng() * 13);

    for (let step = 0; step < maxEvents; step++) {
      if (currentDay > 360) break;
      freq += 1;
      const recency = step === 0 ? 0 : currentDay - prevDay;
      const utilization = Math.min(
        1,
        Math.max(0.05, 0.42 + (1 - creditQuality) * 0.3 + (rng() - 0.5) * 0.25)
      );

      const r = rng();
      let actionId = 0;
      let propensity = 0.48;
      if (creditQuality > 0.72 && r < 0.34) {
        actionId = 1;
        propensity = 0.34;
      } else if (utilization < 0.35 && r < 0.38) {
        actionId = 2;
        propensity = 0.38;
      } else if (utilization > 0.75 && r < 0.18) {
        actionId = 3;
        propensity = 0.18;
      }

      const volume = Math.round((140 + creditQuality * 360 + (rng() - 0.4) * 110) * 100) / 100;
      const riskPenalty = creditQuality < 0.42 && actionId === 1 ? 48 : 0;
      const reward = Math.round((volume * 0.045 - riskPenalty + (actionId === 2 ? 4.5 : 0)) * 100) / 100;

      events.push({
        eventId: `FIN-${u}-${step}`,
        entityId,
        timestampDay: currentDay,
        actionId,
        actionLabel: actions[actionId].label,
        channel: channels[Math.floor(rng() * channels.length)],
        recencyDays: recency,
        frequencyCount: freq,
        spendAmount: volume,
        engagementScore: Math.round(utilization * 1000) / 1000,
        reward,
        propensity: Math.round(propensity * 1000) / 1000,
      });

      prevDay = currentDay;
      currentDay += 9 + Math.floor(rng() * 24);
    }
  }

  return {
    id: 'fintech_credit_policy',
    name: 'Fintech Credit & Offer Policy',
    domain: 'Consumer Fintech',
    description:
      'Card spend cycles, credit-line actions, and risk-adjusted net interest rewards across 190 accounts.',
    actionSpace: actions,
    horizonTotalDays: 360,
    defaultObsCutoffDay: 180,
    defaultHorizonDays: 180,
    events,
  };
}

function generateIndustrialSensorPreset(): DatasetPreset {
  const rng = createRng(63109);
  const actions = [
    { id: 0, label: 'Nominal Run' },
    { id: 1, label: 'Lubrication Service' },
    { id: 2, label: 'Load Derate' },
    { id: 3, label: 'Bearing Overhaul' },
  ];
  const channels = ['Vibration Array', 'Thermal Probe', 'Pressure & RPM Bus'];
  const events: RawEvent[] = [];
  const entityCount = 140;

  for (let u = 0; u < entityCount; u++) {
    const entityId = `TURB-${String(4001 + u).padStart(4, '0')}`;
    const startDay = Math.floor(rng() * 55) + 1;
    const totalLifeCycles = 110 + Math.floor(rng() * 215); // EOL between cycle 111..355
    const eolDay = Math.min(358, startDay + totalLifeCycles);
    const stepInterval = 8 + Math.floor(rng() * 14);
    const baseStress = 32 + rng() * 38;
    let currentDay = startDay;
    let prevDay = currentDay;
    let freq = 0;

    while (currentDay <= eolDay && freq < 22) {
      freq += 1;
      const recency = freq === 1 ? 0 : currentDay - prevDay;
      const progress = Math.min(1, Math.max(0, (currentDay - startDay) / Math.max(1, eolDay - startDay)));
      // Exponential degradation curve near End-Of-Life
      const wearFactor = Math.pow(progress, 1.85);
      const healthIndex = Math.min(
        0.99,
        Math.max(0.06, 0.94 - wearFactor * 0.78 + (rng() - 0.5) * 0.08)
      );

      let actionId = 0;
      let propensity = 0.54;
      const r = rng();
      if (healthIndex < 0.35 && r < 0.36) {
        actionId = 3;
        propensity = 0.28;
      } else if (wearFactor > 0.55 && r < 0.42) {
        actionId = 2;
        propensity = 0.38;
      } else if (freq % 4 === 0 && r < 0.48) {
        actionId = 1;
        propensity = 0.48;
      }

      const anomalySpike = rng() < 0.045 ? 1.65 : 1.0;
      const vibrationLoad =
        Math.round(
          (baseStress * (1 + wearFactor * 2.15) * anomalySpike + (rng() - 0.35) * 14) * 100
        ) / 100;
      const maintCost = actionId === 3 ? 28 : actionId === 2 ? 12 : actionId === 1 ? 7 : 0;
      const uptimeReward =
        Math.round((healthIndex * 64 - wearFactor * 38 - maintCost + (rng() - 0.5) * 6) * 100) / 100;

      events.push({
        eventId: `SNS-${u}-${freq - 1}`,
        entityId,
        timestampDay: currentDay,
        actionId,
        actionLabel: actions[actionId].label,
        channel: channels[Math.floor(rng() * channels.length)],
        recencyDays: recency,
        frequencyCount: freq,
        spendAmount: Math.max(10, vibrationLoad),
        engagementScore: Math.round(healthIndex * 1000) / 1000,
        reward: uptimeReward,
        propensity: Math.round(propensity * 1000) / 1000,
      });

      prevDay = currentDay;
      currentDay += stepInterval + Math.floor(rng() * 8);
    }
  }

  return {
    id: 'industrial_sensor_rul',
    name: 'Turbofan & Machinery Sensor Telemetry',
    domain: 'Industrial IoT / RUL',
    description:
      'Multi-sensor rotating machinery telemetry (vibration load, health degradation index, maintenance interventions) across 140 turbine assets.',
    actionSpace: actions,
    horizonTotalDays: 360,
    defaultObsCutoffDay: 180,
    defaultHorizonDays: 180,
    events,
  };
}

export const DATASET_PRESETS: DatasetPreset[] = [
  generateEcommercePreset(),
  generateSaasPreset(),
  generateFintechPreset(),
  generateIndustrialSensorPreset(),
];

export const SAMPLE_CSV_TEMPLATE = `entity_id,timestamp_day,action_id,action_label,channel,spend_amount,engagement_score,reward,propensity
ENT-9001,12,0,Organic,Web,64.50,0.62,21.93,0.45
ENT-9001,29,1,10% Promo,Mobile App,88.00,0.71,21.12,0.38
ENT-9001,51,0,Organic,Web,72.20,0.68,24.55,0.45
ENT-9001,195,3,VIP Bundle,Email,142.00,0.84,39.76,0.32
ENT-9002,8,2,Free Shipping,Web,54.00,0.55,11.86,0.28
ENT-9002,44,1,10% Promo,Email,49.50,0.49,11.88,0.41
ENT-9002,210,0,Organic,Web,61.00,0.58,20.74,0.45`;

export const SAMPLE_SENSOR_CSV_TEMPLATE = `unit_id,cycle,action_id,maintenance_action,sensor_channel,vibration_rms,health_index,uptime_reward,propensity
TURB-9001,10,0,Nominal Run,Vibration Array,38.40,0.92,51.20,0.54
TURB-9001,42,1,Lubrication Service,Thermal Probe,46.10,0.84,42.80,0.48
TURB-9001,95,0,Nominal Run,Pressure & RPM Bus,61.80,0.69,29.50,0.54
TURB-9001,150,2,Load Derate,Vibration Array,89.50,0.48,14.10,0.38
TURB-9001,205,3,Bearing Overhaul,Thermal Probe,124.20,0.24,-9.40,0.28
TURB-9002,15,0,Nominal Run,Vibration Array,34.10,0.95,55.00,0.54
TURB-9002,78,1,Lubrication Service,Pressure & RPM Bus,52.30,0.78,36.20,0.48
TURB-9002,145,2,Load Derate,Vibration Array,81.40,0.53,17.90,0.38
TURB-9002,215,3,Bearing Overhaul,Thermal Probe,118.60,0.28,-4.10,0.28`;

