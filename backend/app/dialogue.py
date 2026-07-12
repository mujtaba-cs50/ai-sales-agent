"""
Inference Module (see SRS section 4.1).

The FYP report's long-term plan is a LoRA fine-tuned TinyLlama 1.1B model.
Training and shipping real model weights needs a GPU + a Kaggle/HF dataset
download, which isn't something that can run inside this handoff. This
module gives you a fully working, deterministic solar-sales dialogue
engine (intent detection + slot filling for lead capture) so the whole
app runs end-to-end today. It is written so the TinyLlama model is a
drop-in replacement later -- see generate_reply() and the note at the
bottom of this file.
"""

import re
from typing import Dict, Optional, Tuple

PRODUCTS = {
    "3kw": {
        "name": "3kW Home Solar",
        "category": "Residential",
        "best_for": "small homes with essential daytime usage and basic appliances",
        "price_pkr": "PKR 750,000 - 900,000",
    },
    "5kw": {
        "name": "5kW Hybrid System",
        "category": "Residential",
        "best_for": "medium homes that need strong daily savings and backup support",
        "price_pkr": "PKR 1,200,000 - 1,450,000",
    },
    "7kw": {
        "name": "7kW Premium Home",
        "category": "Residential",
        "best_for": "larger homes with higher electricity usage and multiple heavy appliances",
        "price_pkr": "PKR 1,700,000 - 2,000,000",
    },
    "10kw": {
        "name": "10kW Business Solar",
        "category": "Commercial",
        "best_for": "shops, offices, and small commercial spaces",
        "price_pkr": "PKR 2,400,000 - 2,800,000",
    },
    "20kw": {
        "name": "20kW Commercial System",
        "category": "Commercial",
        "best_for": "businesses that want larger savings and higher capacity",
        "price_pkr": "PKR 4,600,000 - 5,200,000",
    },
    "battery": {
        "name": "Battery and Inverter",
        "category": "Backup",
        "best_for": "night usage and power outage protection",
        "price_pkr": "PKR 350,000 - 600,000 depending on battery capacity",
    },
}

PHONE_RE = re.compile(r"(\+?92[\s-]?)?0?3\d{2}[\s-]?\d{7}")

GREETING_WORDS = {"hi", "hello", "hey", "salam", "assalam", "asalam"}


def new_session_state() -> Dict:
    return {
        "stage": "start",
        "name": None,
        "phone": None,
        "interest": None,
        "interest_key": None,
        "budget": None,
        "timeline": None,
    }


def _detect_product_key(text_l: str) -> Optional[str]:
    if "battery" in text_l or "backup" in text_l:
        return "battery"
    if "20" in text_l and "kw" in text_l:
        return "20kw"
    if "10" in text_l and "kw" in text_l:
        return "10kw"
    if "7" in text_l and "kw" in text_l:
        return "7kw"
    if "5" in text_l and "kw" in text_l:
        return "5kw"
    if "3" in text_l and "kw" in text_l:
        return "3kw"
    if "commercial" in text_l or "shop" in text_l or "office" in text_l or "business" in text_l:
        return "10kw"
    if "home" in text_l or "house" in text_l or "residential" in text_l:
        return "5kw"
    return None


def _detect_product(text_l: str) -> Optional[dict]:
    key = _detect_product_key(text_l)
    return PRODUCTS[key] if key else None


def _wants_quotation(text_l: str) -> bool:
    keywords = ["quotation", "quote", "contact me", "call me", "sales team", "buy", "purchase", "install it"]
    return any(k in text_l for k in keywords)


def generate_reply(state: Dict, user_text: str) -> Tuple[str, Dict, bool]:
    """
    Advance the conversation by one turn.

    Returns (agent_reply, updated_state, lead_just_captured: bool)
    """
    text = user_text.strip()
    text_l = text.lower()
    lead_captured = False

    # ---- Slot-filling stages take priority over free intent detection ----
    if state["stage"] == "await_name":
        state["name"] = text.title()
        state["stage"] = "await_phone"
        reply = f"Thanks {state['name']}! Could you share a contact number so our sales team can reach you?"
        return reply, state, lead_captured

    if state["stage"] == "await_phone":
        match = PHONE_RE.search(text)
        state["phone"] = match.group(0) if match else text
        state["stage"] = "await_budget"
        reply = "Got it. What is your approximate budget range for this solar system, in PKR?"
        return reply, state, lead_captured

    if state["stage"] == "await_budget":
        state["budget"] = text
        state["stage"] = "await_timeline"
        reply = "Understood. When would you like to install it — right away, within a month, or are you just exploring options for now?"
        return reply, state, lead_captured

    if state["stage"] == "await_timeline":
        state["timeline"] = text
        state["stage"] = "done"
        lead_captured = True
        interest = state["interest"] or "solar"
        reply = (
            f"Perfect, {state['name']}! I have saved your details and our sales team will "
            f"contact you shortly about the {interest} package. Is there anything else you would "
            f"like to know?"
        )
        return reply, state, lead_captured

    # ---- Free-form intent detection ----
    product_key = _detect_product_key(text_l)
    product = PRODUCTS[product_key] if product_key else None
    if product:
        state["interest"] = product["name"]
        state["interest_key"] = product_key

    if any(w in text_l for w in GREETING_WORDS) and state["stage"] == "start":
        state["stage"] = "chatting"
        reply = "Hello! I can help you choose a solar panel package. What type of property do you want solar for — home or commercial?"
        return reply, state, lead_captured

    if "price" in text_l or "cost" in text_l or "kitna" in text_l:
        ref = product or (PRODUCTS.get(state["interest_key"]) if state["interest_key"] else None)
        if ref:
            reply = (
                f"The {ref['name']} is best for {ref['best_for']}. "
                f"It is priced around {ref['price_pkr']}. Would you like a formal quotation?"
            )
        else:
            reply = "Sure — could you tell me which package you're interested in (3kW, 5kW, 7kW, 10kW, 20kW, or Battery backup) so I can share the price?"
        state["stage"] = "chatting"
        return reply, state, lead_captured

    if "battery" in text_l or "backup" in text_l:
        b = PRODUCTS["battery"]
        reply = (
            f"Yes, we offer battery backup add-ons. Our {b['name']} package is designed for "
            f"{b['best_for']}, priced at {b['price_pkr']}. Would you like this paired with a solar package?"
        )
        state["stage"] = "chatting"
        return reply, state, lead_captured

    if "install" in text_l:
        reply = "Installation typically takes 3-7 days after site inspection, done by our certified technicians. Would you like to schedule a free site visit?"
        state["stage"] = "chatting"
        return reply, state, lead_captured

    if _wants_quotation(text_l):
        if state["name"] is None:
            state["stage"] = "await_name"
            reply = "I would be happy to arrange that. Could I get your name, please?"
            return reply, state, lead_captured

    if product:
        reply = (
            f"The {product['name']} is a great fit for {product['best_for']}. "
            f"Would you like pricing, battery backup options, or a quotation for it?"
        )
        state["stage"] = "chatting"
        return reply, state, lead_captured

    # Fallback
    state["stage"] = "chatting"
    reply = (
        "Based on your requirement, I can recommend a suitable solar package (3kW, 5kW, 7kW for "
        "homes, 10kW/20kW for businesses, or a Battery backup unit) and arrange a quotation. "
        "Could you tell me a bit more about what you need?"
    )
    return reply, state, lead_captured


def build_lead_dict(state: Dict) -> Dict:
    return {
        "customer_name": state.get("name") or "Website Visitor",
        "city": "Online inquiry",
        "phone_number": state.get("phone") or "Not provided",
        "interest": state.get("interest") or "Solar Package",
        "budget": state.get("budget") or "Not specified",
        "timeline": state.get("timeline") or "Not specified",
        "note": "Lead captured automatically by the AI voice sales agent.",
        "status": "New",
    }


# ---------------------------------------------------------------------------
# Swapping in a real fine-tuned TinyLlama model later:
#
# 1. pip install llama-cpp-python (or ctransformers)
# 2. Download/train a GGUF-quantized, LoRA fine-tuned TinyLlama checkpoint.
# 3. Replace the body of generate_reply() with a call to the model, e.g.:
#
#       from llama_cpp import Llama
#       llm = Llama(model_path="tinyllama-solar-sales.Q4_K_M.gguf")
#       output = llm(prompt, max_tokens=120)["choices"][0]["text"]
#
#    Keep the slot-filling state machine around the model call so the app
#    still reliably captures name/phone/budget/timeline for the leads table,
#    and use the model only for the natural-language product Q&A parts.
# ---------------------------------------------------------------------------
