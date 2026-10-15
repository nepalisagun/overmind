import re
from datetime import timedelta

from django.db.models import (
    Case,
    CharField,
    Count,
    F,
    Max,
    Min,
    OuterRef,
    Q,
    Subquery,
    Sum,
    Value,
    When,
)
from django.db.models.functions import Coalesce, Now, NullIf

RUN_ORDERING_FIELDS = ("status", "name", "models", "dataset", "duration", "credits", "created_at")


def displayed_run_name(name, base_model):
    def normalize(value):
        return re.sub(r"[\s\-_/.:]+", "", value.lower())

    raw = (name or "").strip()
    keys = [normalize(base_model), normalize(base_model.split("/", 1)[-1])]
    parts = [part.strip() for part in raw.split(" · ") if part.strip()]
    parts = [
        part
        for part in parts
        if not any(key and (key in normalize(part) or normalize(part) in key) for key in keys)
    ]
    return " · ".join(parts) or raw


def ordered_training_runs(base, matching, ordering):
    matching_keys = (
        matching.order_by().annotate(run_key=Coalesce("group_id", "id")).values("run_key")
    )
    members = base.order_by().annotate(run_key=Coalesce("group_id", "id"))
    latest = members.filter(run_key=OuterRef("run_key")).order_by("-created_at", "id")
    terminal = ("succeeded", "failed", "cancelled")
    elapsed = Case(
        When(status__in=terminal, then=Coalesce("completed_at", "updated_at")),
        default=Now(),
    ) - Coalesce("started_at", "created_at")
    # Aggregate all members of a matching run, including those excluded by filters.
    runs = (
        members.filter(run_key__in=Subquery(matching_keys))
        .annotate(member_elapsed=elapsed)
        .values("run_key")
        .annotate(
            latest_at=Max("created_at"),
            first_at=Min("created_at"),
            run_name=Max(Subquery(latest.exclude(name="").values("name")[:1])),
            name_base=Max(Subquery(latest.exclude(name="").values("base_model")[:1])),
            model_name=Min("base_model"),
            dataset_name=Max(Subquery(latest.values("dataset__name")[:1])),
            elapsed=Max(
                Case(When(member_elapsed__gte=timedelta(seconds=1), then=F("member_elapsed")))
            ),
            cost=Sum("cost_usd"),
            running=Count("id", filter=Q(status="running")),
            nonterminal=Count("id", filter=~Q(status__in=terminal)),
            failed=Count("id", filter=Q(status="failed")),
            noncancelled=Count("id", filter=~Q(status="cancelled")),
        )
        .annotate(
            run_status=Case(
                When(running__gt=0, then=Value("running")),
                When(
                    nonterminal__gt=0,
                    then=Max(Subquery(latest.exclude(status__in=terminal).values("status")[:1])),
                ),
                When(failed__gt=0, then=Value("failed")),
                When(noncancelled=0, then=Value("cancelled")),
                default=Value("succeeded"),
                output_field=CharField(),
            ),
            named_run=NullIf("run_name", Value("")),
        )
    )
    fields = {
        "status": "run_status",
        "name": "named_run",
        "models": "model_name",
        "dataset": "dataset_name",
        "duration": "elapsed",
        "credits": "cost",
        "created_at": "first_at",
    }
    if not ordering:
        return runs.order_by("-latest_at", "run_key")
    if ordering.lstrip("-") == "name":
        # The Console removes base-model segments from the displayed run name.
        return sorted(
            runs.order_by("run_key"),
            key=lambda run: (
                displayed_run_name(run["run_name"], run["name_base"] or "")
                or str(run["run_key"])[:8]
            ).casefold(),
            reverse=ordering.startswith("-"),
        )
    field = F(fields[ordering.lstrip("-")])
    return runs.order_by(
        field.desc(nulls_last=True) if ordering.startswith("-") else field.asc(nulls_last=True),
        "run_key",
    )
