export interface AdvisorResult {
  reply: string;
  leadData?: {
    name?: string;
    phone?: string;
    city?: string;
    product?: string;
    status: 'Hot' | 'Warm' | 'New';
    note?: string;
  };
}

export function generateSolarAdvisorResponse(
  userText: string,
  productContext?: string | null,
  history?: { sender: string; text: string }[]
): AdvisorResult {
  const q = (userText || '').toLowerCase().trim();

  // 1. Contact / Name / Phone detection
  const phonePattern = /(?:(?:\+92|0092|92)?[-.\s]?(?:3\d{2})[-.\s]?\d{7}|\b0\d{10}\b|\b03\d{9}\b|\b\d{11}\b)/;
  const phoneMatch = q.match(phonePattern);

  const nameMatch = q.match(
    /(?:my\s+name\s+is|mera\s+naam\s+(?:hai\s+)?|mera\s+name\s+(?:hai\s+)?|name[:\s]+|i\s+am|i'm|this\s+is|call\s+me)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i
  );

  let detectedName = nameMatch ? nameMatch[1].replace(/\s+(?:from|living|in|at|and|contact|number|phone)\b.*$/i, '').trim() : '';

  // City detection
  const pakCities = [
    'Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan',
    'Peshawar', 'Gujranwala', 'Sialkot', 'Quetta', 'Hyderabad', 'Bahawalpur',
    'Sargodha', 'Sukkur', 'Abbottabad', 'Wah Cantt', 'Gujrat'
  ];
  let detectedCity = '';
  for (const city of pakCities) {
    if (new RegExp(`\\b${city}\\b`, 'i').test(userText)) {
      detectedCity = city;
      break;
    }
  }

  if (phoneMatch || detectedName) {
    const cust = detectedName || 'Valued Customer';
    const num = phoneMatch ? phoneMatch[0] : '';
    const cityStr = detectedCity ? ` in ${detectedCity}` : '';
    return {
      reply: `Thank you, ${cust}! I have recorded your contact details${num ? ` (${num})` : ''}${cityStr}. Our senior solar engineer will contact you shortly to review your rooftop layout and prepare a customized quotation.`,
      leadData: {
        name: cust,
        phone: num,
        city: detectedCity || 'Pakistan',
        product: productContext || 'Solar Consultation',
        status: 'Hot',
        note: `Contact captured via conversation: "${userText}"`,
      },
    };
  }

  // 2. Greetings & Salutations (English and Roman Urdu)
  if (/^(hi|hello|hey|salam|slam|assalam|aoa|kese ho|kaise ho|kia hal|kya haal|good morning|good evening)/i.test(q)) {
    return {
      reply: 'Walaikum Assalam and hello! I am your AI Solar Advisor. I can help you find the right system size for your home or business, calculate your electricity bill savings, and explain net metering and battery backup. What is your average monthly electricity bill or which package would you like to explore?',
    };
  }

  // 3. Monthly Electricity Bill Sizing (e.g. 25k, 40,000, 60k, 1 lakh, units)
  const billPattern = /(?:rs\.?|pkr|bill|cost|units?)?\s*(\d{1,3})(?:k|\s?thousand|\s?,000|\s?lac|\s?lakh)?\s*(?:rs|pkr|rupees|bill|units)?/i;
  const hasBillIntent = q.includes('bill') || q.includes('unit') || q.includes('kharcha') || q.includes('bijli') || q.includes('consume') || q.includes('per month') || q.includes('mahina');

  // Extract explicit bill number
  const numMatch = q.match(/(\d{1,3})(?:k|\s?thousand|\s?,?000)\b/i) || (hasBillIntent ? q.match(/\b(\d{2,6})\b/) : null);

  if (numMatch || hasBillIntent) {
    let bill = 35000;
    if (numMatch) {
      const raw = parseInt(numMatch[1], 10);
      bill = raw < 1000 ? raw * 1000 : raw;
    }

    if (bill <= 25000) {
      return {
        reply: `For a monthly bill of around ${bill.toLocaleString()} PKR, a 3kW Home Solar System is the ideal choice. It produces 12 to 15 units daily and powers 1 Inverter AC during the day along with refrigerator, fans, and lights, cutting your electricity bill by 75% to 85%. Turnkey price is approximately 750k - 880k PKR. Would you like to schedule a free rooftop survey?`,
      };
    } else if (bill <= 50000) {
      return {
        reply: `With a monthly bill of around ${bill.toLocaleString()} PKR, a 5kW Hybrid Solar System is Pakistan's most popular solution. It generates 22 to 26 units daily, powers 2 Inverter ACs (1.5 Ton), water pump, fridge, and full household lighting, reducing your bill close to zero with Net Metering. Turnkey package costs around 1.2M - 1.45M PKR. Would you like to request a quotation?`,
      };
    } else if (bill <= 80000) {
      return {
        reply: `For a monthly bill of around ${bill.toLocaleString()} PKR, a 7kW to 8kW Solar System is recommended. It produces 32 to 38 units daily, easily running 3 Inverter ACs, water motor, and full home loads for 1 Kanal houses, virtually eliminating expensive peak-hour grid tariffs. Would you like us to prepare an itemized quote?`,
      };
    } else if (bill <= 150000) {
      return {
        reply: `For a heavy bill of ${bill.toLocaleString()} PKR, a 10kW Three-Phase Hybrid System is the perfect match. It generates 45 to 55 units daily and powers 4 Inverter ACs and heavy appliances. Through green net metering, it wipes out massive WAPDA / K-Electric bills. Turnkey cost is approximately 2.35M - 2.75M PKR. Would you like a site engineer to visit your property?`,
      };
    } else {
      return {
        reply: `For commercial, industrial, or large residential setups with bills over ${bill.toLocaleString()} PKR, a 15kW to 20kW Three-Phase system is ideal. It produces 90 to 110 units daily and drastically cuts commercial maximum demand charges. Would you like our commercial project head to connect with you?`,
      };
    }
  }

  // 4. Inverter AC appliance queries (e.g. "how many AC can run on 5kw?", "2 AC chalana hy")
  if (q.includes('ac') || q.includes('air conditioner') || q.includes('ton')) {
    if (q.includes('3kw')) {
      return {
        reply: 'A 3kW solar system can comfortably run 1 Inverter AC (up to 1.5 Ton) during peak sunshine hours along with basic appliances like 1 refrigerator, 4-5 fans, and LED lights.',
      };
    }
    if (q.includes('5kw') || q.includes('5 kw')) {
      return {
        reply: 'A 5kW hybrid solar system can easily run 2 Inverter ACs (1.5 Ton each) simultaneously during sunlight hours, plus a water pump (when AC is paused), refrigerator, and all lights and fans.',
      };
    }
    if (q.includes('7kw') || q.includes('8kw')) {
      return {
        reply: 'A 7kW or 8kW solar system can run 3 Inverter ACs simultaneously along with home appliances, deep freezer, and automatic water pumping.',
      };
    }
    if (q.includes('10kw') || q.includes('10 kw')) {
      return {
        reply: 'A 10kW three-phase solar system can power 4 to 5 Inverter ACs simultaneously, making it suitable for large villas, commercial marts, clinics, and offices.',
      };
    }
    return {
      reply: 'On standard Pakistani inverter ACs: A 3kW system runs 1 AC, a 5kW system runs 2 ACs, a 7kW system runs 3 ACs, and a 10kW system runs 4 to 5 ACs during sunlight hours. How many ACs are you planning to run in your home?',
    };
  }

  // 5. Specific Package Pricing & Cost inquiries
  if (q.includes('price') || q.includes('cost') || q.includes('rate') || q.includes('kitne') || q.includes('kitnay') || q.includes('paisa') || q.includes('quotation') || q.includes('quote')) {
    if (q.includes('3kw')) {
      return {
        reply: 'Our turnkey 3kW Home Solar System costs between 750,000 and 880,000 PKR. This includes Tier-1 N-Type TOPCon panels, 3.2kW hybrid inverter, structure, AC/DC distribution box, installation, and testing.',
      };
    }
    if (q.includes('5kw')) {
      return {
        reply: 'Our turnkey 5kW Hybrid Residential System costs between 1.2M and 1.45M PKR. It includes Tier-1 bifacial panels, 5kW hybrid inverter (Inverex/Growatt), net metering preparation, and complete warranty.',
      };
    }
    if (q.includes('7kw')) {
      return {
        reply: 'A 7kW Premium Home Solar package is priced between 1.65M and 1.95M PKR turnkey, designed for 1 Kanal homes with dual MPPT high-yield inverters and 25-year panel performance warranties.',
      };
    }
    if (q.includes('10kw')) {
      return {
        reply: 'A 10kW Three-Phase Commercial or Large Residential System is priced between 2.35M and 2.75M PKR turnkey, complete with three-phase net metering documentation and installation.',
      };
    }
    if (q.includes('20kw')) {
      return {
        reply: 'A 20kW Industrial / Commercial System is 4.5M to 5.2M PKR turnkey, engineered for warehouses, plazas, and manufacturing units with high-output bifacial panels.',
      };
    }
    return {
      reply: 'Our complete turnkey packages in Pakistan: 3kW (750k-880k PKR), 5kW (1.2M-1.45M PKR), 7kW (1.65M-1.95M PKR), 10kW (2.35M-2.75M PKR), and Battery backup systems from 380k PKR. Which system capacity matches your requirement?',
    };
  }

  // 6. Net Metering & Green Meter (NEPRA, LESCO, K-Electric, IESCO, FESCO)
  if (q.includes('net meter') || q.includes('green meter') || q.includes('nepra') || q.includes('disco') || q.includes('lesco') || q.includes('k-electric') || q.includes('kelectric') || q.includes('iesco')) {
    return {
      reply: 'Net Metering lets you export excess solar electricity produced during the sunny day back to WAPDA / K-Electric. At night, you consume electricity against those earned credits, driving your monthly bill to near zero. We manage the complete end-to-end process: application, DISCO inspection, green bi-directional meter installation, and NEPRA generation license.',
    };
  }

  // 7. Load Shedding, Outage & Battery Backup (Lithium vs Tubular)
  if (q.includes('battery') || q.includes('backup') || q.includes('load shedding') || q.includes('outage') || q.includes('light jati') || q.includes('bijli jati') || q.includes('ups')) {
    return {
      reply: 'Yes, with our Hybrid Solar Systems you enjoy zero blackout! The system switches to battery backup in less than 10 milliseconds during load shedding. We provide maintenance-free 51.2V 100Ah (5.12kWh) LiFePO4 Lithium batteries (6000+ cycles) as well as heavy deep-cycle flooded tubular batteries. Would you like a backup battery quote?',
    };
  }

  // 8. Solar Panel Brands & Quality (Longi, Jinko, Canadian, N-Type, Bifacial)
  if (q.includes('panel') || q.includes('plate') || q.includes('bifacial') || q.includes('longi') || q.includes('jinko') || q.includes('canadian') || q.includes('tier 1') || q.includes('tier-1')) {
    return {
      reply: 'We only supply authentic Tier-1 Grade-A solar panels: Longi Hi-MO 6 Explorer 585W and Jinko Tiger Neo 585W N-Type TOPCon Dual-Glass Bifacial. Bifacial panels produce 15% to 25% extra energy from rear-reflected sunlight, and come with a 12-15 year product warranty and a 25-30 year linear power performance warranty.',
    };
  }

  // 9. Solar Inverter Brands (Inverex, Growatt, Huawei, Knox, Hybrid vs On-Grid)
  if (q.includes('inverter') || q.includes('hybrid') || q.includes('on-grid') || q.includes('off-grid') || q.includes('inverex') || q.includes('growatt') || q.includes('huawei')) {
    return {
      reply: 'We install premium hybrid inverters including Inverex Nitrox, Growatt SPH, and Huawei SUN2000 with Dual MPPT, IP65 waterproof outdoor rating, mobile Wi-Fi monitoring, and 5 years official local warranty. A hybrid inverter is recommended because it supports both net metering grid-export and battery backup during power cuts.',
    };
  }

  // 10. Rooftop Area & Space requirements
  if (q.includes('space') || q.includes('roof') || q.includes('area') || q.includes('chhat') || q.includes('kitni jagah') || q.includes('marla') || q.includes('kanal')) {
    return {
      reply: 'As a rule of thumb, every 1kW of solar capacity requires approximately 80 to 90 square feet of shadow-free rooftop space. For example, a 5kW system needs around 400 to 450 sq ft, while a 10kW system needs around 800 to 900 sq ft. Our engineer can perform a free satellite and on-site shade inspection for your roof.',
    };
  }

  // 11. Site Survey / Rooftop Inspection / Booking
  if (q.includes('survey') || q.includes('visit') || q.includes('inspect') || q.includes('book') || q.includes('check') || q.includes('rabta')) {
    return {
      reply: 'We offer free, zero-obligation rooftop site surveys across all major cities in Pakistan! Please provide your name, phone number, and city or address so our engineering team can schedule your inspection visit.',
    };
  }

  // 12. Selected Product Context
  if (productContext) {
    return {
      reply: `Regarding the ${productContext}: It is one of our top-performing Tier-1 systems with 25-year performance warranty. What is your approximate monthly electricity bill or city so I can confirm if it is the perfect fit for your home?`,
    };
  }

  // 13. General Consultation Fallback (Vibrant, informative, helpful)
  const defaultConsultations = [
    'We provide complete turnkey solar solutions across Pakistan. To give you the exact sizing and cost breakdown, could you tell me your average monthly electricity bill or which city you are located in?',
    'Solar energy reduces electricity bills by up to 90% in Pakistan while providing seamless power during load shedding. Are you looking for a residential home setup, commercial package, or battery backup system?',
    'Our systems feature Tier-1 Longi/Jinko panels and Inverex/Growatt hybrid inverters with full net metering support. What appliances do you want to power with solar?',
  ];

  return {
    reply: defaultConsultations[Math.floor(Math.random() * defaultConsultations.length)],
  };
}
