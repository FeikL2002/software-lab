#!/usr/bin/env python3
"""Approval-first growth assistant for CleanConnect by AmericanSites.us."""

from __future__ import annotations

import argparse
import csv
import os
from datetime import date, datetime
from pathlib import Path

from openai import OpenAI


ROOT = Path(__file__).resolve().parent
GENERATED = ROOT / "generated"
LEADS = ROOT / "leads.csv"
MODEL = os.getenv("OPENAI_MODEL", "gpt-5.6")

BRAND_CONTEXT = """
Brand: CleanConnect by AmericanSites.us
Audience: owners of residential and commercial cleaning companies in the United States.
Core promise: help cleaning companies turn their online presence into more qualified quote
requests through a professional website, clear offers, trust-building content, and simple
conversion tools.
Voice: practical, encouraging, plainspoken, trustworthy, and never pushy.
Rules:
- Never claim guaranteed leads, revenue, rankings, or business results.
- Never invent facts, reviews, statistics, prices, or client outcomes.
- Avoid spam, manipulation, fake urgency, and insulting a prospect's current website.
- All posts and outreach messages are drafts requiring human review before publishing.
""".strip()


def ask_agent(instructions: str, request: str) -> str:
    if not os.getenv("OPENAI_API_KEY"):
        raise SystemExit(
            "OPENAI_API_KEY is missing. Add it to your terminal, then run this command again."
        )
    client = OpenAI()
    response = client.responses.create(
        model=MODEL,
        instructions=f"{BRAND_CONTEXT}\n\n{instructions}",
        input=request,
    )
    return response.output_text.strip()


def save_markdown(prefix: str, content: str) -> Path:
    GENERATED.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    path = GENERATED / f"{prefix}_{stamp}.md"
    path.write_text(content + "\n", encoding="utf-8")
    return path


def content_command(args: argparse.Namespace) -> None:
    instructions = """
You are the CleanConnect Content Agent. Create a one-week Facebook content pack.
Return polished copy, not an explanation. Include:
1. Three posts: one educational, one conversation-starting, and one gentle offer.
2. A short suggested image or graphic concept for each post.
3. One useful comment the owner can leave on somebody else's relevant Facebook post.
4. A simple call to action that fits the weekly topic.
Use short paragraphs and natural language. Do not use more than two hashtags per post.
""".strip()
    request = (
        f"Weekly topic or goal: {args.topic}\n"
        f"Target segment: {args.segment}\n"
        f"Location emphasis: {args.location}\n"
        f"Today's date: {date.today().isoformat()}"
    )
    result = ask_agent(instructions, request)
    path = save_markdown("content_pack", result)
    print(result)
    print(f"\nSaved draft: {path}")


def ensure_lead_file() -> None:
    if LEADS.exists():
        return
    with LEADS.open("w", newline="", encoding="utf-8") as file:
        csv.writer(file).writerow(
            [
                "date_added",
                "business",
                "location",
                "website",
                "public_notes",
                "status",
                "next_action",
            ]
        )


def prospect_command(args: argparse.Namespace) -> None:
    instructions = """
You are the CleanConnect Prospect Assistant. Analyze only the public details supplied by
the user. Do not pretend you visited links or verified anything that is not in those details.
Return:
1. FIT SCORE: 1-10, with a one-sentence reason.
2. OPPORTUNITIES: three specific, respectful observations.
3. FIRST MESSAGE: a personalized Facebook message under 90 words. Lead with a genuine
observation and one helpful idea; do not pitch aggressively.
4. FOLLOW-UP: a polite follow-up under 55 words for use no sooner than five business days
after the first message.
5. NEXT ACTION: one concrete action for the owner.
""".strip()
    request = (
        f"Business: {args.business}\n"
        f"Location: {args.location}\n"
        f"Website or public page: {args.website or 'Not provided'}\n"
        f"Public observations supplied by user: {args.notes}"
    )
    result = ask_agent(instructions, request)
    ensure_lead_file()
    with LEADS.open("a", newline="", encoding="utf-8") as file:
        csv.writer(file).writerow(
            [
                date.today().isoformat(),
                args.business,
                args.location,
                args.website,
                args.notes,
                "Research drafted",
                "Review draft and personalize before sending",
            ]
        )
    path = save_markdown(f"prospect_{safe_name(args.business)}", result)
    print(result)
    print(f"\nSaved draft: {path}")
    print(f"Lead added to: {LEADS}")


def ads_command(args: argparse.Namespace) -> None:
    instructions = """
You are the CleanConnect Facebook Groups Advertising Agent. Write promotional posts for
Facebook groups where cleaning-business owners gather. Every draft must follow these rules:
- Assume the owner will confirm that promotional posts are allowed by the group.
- Sound like a helpful small-business owner, not a corporate advertisement.
- Do not use fake scarcity, guaranteed results, invented testimonials, or income claims.
- Do not criticize people for having no website or a weak website.
- Offer a free CleanConnect mini-page that can be linked from social profiles so customers
  can see services, contact the cleaner, and request a quote.
- Explain that optional full websites are available separately through AmericanSites.us.
- Do not suggest mass-posting or sending unsolicited direct messages.

Return:
1. COMMUNITY-FIRST POST: useful and conversational, 90-140 words.
2. DIRECT OFFER POST: clear promotion, 70-110 words.
3. SHORT POST: under 55 words.
4. COMMENT REPLY: under 45 words for someone asking how to look more professional online.
5. FOLLOW-UP COMMENT: under 35 words that answers “What is included?”
6. IMAGE IDEA: one simple graphic concept.
7. REVIEW CHECKLIST: five short facts the owner must verify before posting.

Use no more than two emojis per draft and no more than two hashtags.
""".strip()
    request = (
        f"Target group type: {args.group}\n"
        f"Target location: {args.location}\n"
        f"Call to action or signup link: {args.link}\n"
        f"Special emphasis: {args.focus}\n"
        f"Today's date: {date.today().isoformat()}"
    )
    result = ask_agent(instructions, request)
    path = save_markdown("facebook_group_ads", result)
    print(result)
    print(f"\nSaved draft: {path}")


def safe_name(value: str) -> str:
    cleaned = "".join(char.lower() if char.isalnum() else "_" for char in value)
    return "_".join(part for part in cleaned.split("_") if part)[:50] or "lead"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="CleanConnect content and prospecting assistant"
    )
    commands = parser.add_subparsers(dest="command", required=True)

    content = commands.add_parser("content", help="Create a one-week Facebook content pack")
    content.add_argument("--topic", required=True, help="Weekly topic or goal")
    content.add_argument(
        "--segment", default="residential and commercial cleaning companies"
    )
    content.add_argument("--location", default="United States")
    content.set_defaults(func=content_command)

    prospect = commands.add_parser("prospect", help="Analyze one potential client")
    prospect.add_argument("--business", required=True)
    prospect.add_argument("--location", required=True)
    prospect.add_argument("--website", default="")
    prospect.add_argument(
        "--notes",
        required=True,
        help="Public facts you observed; do not include private or sensitive information",
    )
    prospect.set_defaults(func=prospect_command)

    ads = commands.add_parser(
        "ads", help="Create Facebook group advertisements for CleanConnect"
    )
    ads.add_argument(
        "--group", default="Facebook groups for residential cleaning business owners"
    )
    ads.add_argument("--location", default="United States")
    ads.add_argument(
        "--link",
        default="Add the CleanConnect signup link after the public page is launched",
    )
    ads.add_argument(
        "--focus",
        default="A free professional mini-page that turns one social-media link into a simple quote-request page",
    )
    ads.set_defaults(func=ads_command)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
