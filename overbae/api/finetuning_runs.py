from rest_framework import serializers

from overbae.services.finetuning_runs import RUN_ORDERING_FIELDS


class FinetuningRunOrderingSerializer(serializers.Serializer):
    ordering = serializers.ChoiceField(
        choices=[direction + field for field in RUN_ORDERING_FIELDS for direction in ("", "-")],
        required=False,
    )
