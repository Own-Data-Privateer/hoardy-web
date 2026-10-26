# Copyright (c) 2023-2024 Jan Malakhovski <oxij@oxij.org>
#
# This file is a part of `hoardy-web` project.
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <http://www.gnu.org/licenses/>.

"""Loading of `mitmproxy` `mitmdump` files into `Reqres` structures."""

import io as _io
import os as _os
import struct as _struct
import typing as _t

from mitmproxy.io import FlowReader
from mitmproxy.http import HTTPFlow

from .wrr import *


def _hd(x: _t.Any) -> Headers:
    res = []
    for k, v in x.fields:
        res.append((k.decode("ascii"), v))
    return Headers(res)


def mitmproxy_load_flow(flow: HTTPFlow) -> Reqres | None:
    rq = flow.request
    if rq.scheme == "" and rq.method.upper() == "CONNECT":
        # skip mitmproxy CONNECT requests, these are logged by mitmproxy
        # when a browser tries to connect to a target host via mitmproxy,
        # they don't carry any useful info
        return None

    rq.decode()
    rq_body = rq.get_content()
    rq_complete = True
    if rq_body is None:
        rq_body = b""
        rq_complete = False

    if rq_complete:
        cl = rq.headers.get("content-length", None)
        if cl is not None and int(cl) != len(rq_body):
            rq_complete = False

    if (rq.scheme == "http" and rq.port == 80) or (rq.scheme == "https" and rq.port == 443):
        maybeport = ""
    else:
        maybeport = ":" + str(rq.port)
    url = f"{rq.scheme}://{rq.host}{maybeport}{rq.path}"

    request = Request(
        TimeStamp(rq.timestamp_start),
        rq.method.upper(),
        parse_url(url),
        _hd(rq.headers),
        rq_complete,
        rq_body,
    )

    rs = flow.response
    if rs is not None:
        rs.decode()
        rs_body = rs.get_content()
        rs_complete = True
        if rs_body is None:
            rs_body = b""
            rs_complete = False

        if rs_complete:
            cl = rs.headers.get("content-length", None)
            if cl is not None and int(cl) != len(rs_body):
                rs_complete = False

        response = Response(
            TimeStamp(rs.timestamp_start),
            rs.status_code,
            rs.reason,
            _hd(rs.headers),
            rs_complete,
            rs_body,
        )

        tend = rs.timestamp_end
        if tend is None:
            tend = rs.timestamp_start
    else:
        response = None
        tend = rq.timestamp_end
        if tend is None:
            tend = rq.timestamp_start

    finished_at = TimeStamp(tend)

    wsstream = None
    if flow.websocket is not None:
        ws = flow.websocket

        wsstream = []
        for msg in ws.messages:
            if isinstance(msg.content, bytes):
                content = msg.content
            elif isinstance(msg.content, str):
                # even though mitmproxy declares content to be `bytes`, reading
                # dump files produced by old mitmproxy can produce `str`
                content = msg.content.encode("utf-8")
            else:
                assert False
            wsstream.append(
                WebSocketFrame(TimeStamp(msg.timestamp), msg.from_client, int(msg.type), content)
            )

        if ws.timestamp_end is not None:
            assert ws.closed_by_client is not None
            assert ws.close_code is not None
            assert ws.close_reason is not None

            # reconstruct the CLOSE frame
            wsstream.append(
                WebSocketFrame(
                    TimeStamp(ws.timestamp_end),
                    ws.closed_by_client,
                    0x8,
                    _struct.pack("!H", ws.close_code) + ws.close_reason.encode("utf-8"),
                )
            )

    return Reqres(
        1, "hoardy-mitmproxy/1", rq.http_version, request, response, finished_at, {}, wsstream
    )


def mitmproxy_load(
    fobj: _io.BufferedReader,
    on_error: _t.Callable[[Failure], None] = raise_one,
    elaborate: _t.Callable[[_t.Any], _t.Any] = identity,
) -> _t.Iterator[tuple[int, Reqres]]:
    stream = FlowReader(fobj).stream()
    n = 0
    for flow in stream:
        try:
            if not isinstance(flow, HTTPFlow):
                raise Failure("unknown stream element type: `%s`", type(flow).__name__)
            reqres = mitmproxy_load_flow(flow)
            if reqres is not None:
                yield n, reqres
        except Failure as exc:
            on_error(elaborate(exc.elaborate("while parsing stream element %d", n)))
        except CatastrophicFailure as exc:
            raise elaborate(  # pylint: disable=raise-missing-from
                exc.elaborate("while parsing stream element %d", n)
            )
        n += 1


def rrexpr_mitmproxy_load(
    fobj: _io.BufferedReader,
    source: DeferredSourceType,
    on_error: _t.Callable[[Failure], None] = raise_one,
    elaborate: _t.Callable[[_t.Any], _t.Any] = identity,
) -> _t.Iterator[ReqresExpr[StreamElementSource[DeferredSourceType]]]:
    for n, reqres in mitmproxy_load(fobj, on_error, elaborate):
        yield ReqresExpr(StreamElementSource(source, n), reqres)


def rrexpr_mitmproxy_loadf(
    path: str | bytes,
    on_error: _t.Callable[[Failure], None] = raise_one,
) -> _t.Iterator[ReqresExpr[StreamElementSource[FileSource]]]:
    def elaborate[F: CatastrophicFailure](exc: F) -> F:
        return exc.elaborate("while parsing `%s` with `%s` parser", fsdecode(path), "mitmproxy")

    with open(path, "rb") as f:
        in_stat = _os.fstat(f.fileno())
        yield from rrexpr_mitmproxy_load(f, FileSource(path, in_stat), on_error, elaborate)
