// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {SimpleAccount} from "account-abstraction/samples/SimpleAccount.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract SimpleAccountFactoryCompat {
    IEntryPoint public immutable entryPoint;
    address public immutable accountImplementation;

    event AccountCreated(address indexed account, address indexed owner, uint256 salt);

    constructor(IEntryPoint _entryPoint) {
        require(address(_entryPoint) != address(0), "SimpleAccountFactoryCompat: entryPoint=0");
        entryPoint = _entryPoint;

        SimpleAccount impl = new SimpleAccount(_entryPoint);
        accountImplementation = address(impl);
    }

    function _proxyInitCode(address owner) internal view returns (bytes memory) {
        bytes memory initData = abi.encodeCall(SimpleAccount.initialize, (owner));
        return abi.encodePacked(type(ERC1967Proxy).creationCode, abi.encode(accountImplementation, initData));
    }

    function getAddress(address owner, uint256 salt) external view returns (address) {
        bytes memory proxyInitCode = _proxyInitCode(owner);
        return address(
            uint160(
                uint256(
                    keccak256(abi.encodePacked(bytes1(0xff), address(this), bytes32(salt), keccak256(proxyInitCode)))
                )
            )
        );
    }

    function createAccount(address owner, uint256 salt) external returns (address account) {
        (bool ok, bytes memory ret) =
            address(entryPoint).staticcall(abi.encodeWithSelector(bytes4(keccak256("senderCreator()"))));
        if (ok && ret.length == 32) {
            address sc = abi.decode(ret, (address));
            if (sc != address(0)) {
                require(msg.sender == sc, "SimpleAccountFactoryCompat: not senderCreator");
            }
        }

        account = this.getAddress(owner, salt);
        if (account.code.length > 0) {
            return account;
        }

        bytes memory proxyInitCode = _proxyInitCode(owner);
        address deployed;
        assembly {
            deployed := create2(0, add(proxyInitCode, 0x20), mload(proxyInitCode), salt)
        }
        require(deployed != address(0), "SimpleAccountFactoryCompat: create2 failed");

        emit AccountCreated(account, owner, salt);
        return account;
    }
}
